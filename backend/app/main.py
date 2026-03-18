import asyncio
import json
import os
import shutil
import uuid
import threading
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .models import JobStatus, YouTubeRequest, JobResponse, JobResult
from .services.downloader import download_youtube, fetch_youtube_title
from .services.separator import separate_stems
from .services.analyzer import analyze_track

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
SEPARATED_DIR = BASE_DIR / "separated"

# In-memory job store
jobs: dict[str, dict] = {}

# Cancel events per job
cancel_events: dict[str, threading.Event] = {}

# WebSocket connections per job
ws_connections: dict[str, list[WebSocket]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(exist_ok=True)
    SEPARATED_DIR.mkdir(exist_ok=True)
    yield


app = FastAPI(title="Stem Splitter", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def notify_job(job_id: str, data: dict):
    conns = ws_connections.get(job_id, [])
    for ws in conns:
        try:
            await ws.send_json(data)
        except Exception:
            pass


async def process_job(job_id: str, audio_path: str, title: str, model: str = "htdemucs_6s"):
    job = jobs[job_id]
    cancel = cancel_events.get(job_id)

    try:
        job["status"] = JobStatus.SEPARATING
        await notify_job(job_id, {
            "status": JobStatus.SEPARATING,
            "message": "Separating stems...",
            "progress": 0,
        })

        loop = asyncio.get_event_loop()
        progress_queue = asyncio.Queue()

        def on_progress(pct, msg):
            asyncio.run_coroutine_threadsafe(
                progress_queue.put({"pct": pct, "msg": msg}), loop
            )

        async def forward_progress():
            while True:
                item = await progress_queue.get()
                if item is None:
                    break
                await notify_job(job_id, {
                    "status": JobStatus.SEPARATING,
                    "message": item["msg"],
                    "progress": item["pct"],
                })

        progress_task = asyncio.create_task(forward_progress())

        # Run separation and analysis in parallel
        separate_future = loop.run_in_executor(
            None,
            lambda: separate_stems(
                audio_path,
                str(SEPARATED_DIR),
                model=model,
                on_progress=on_progress,
                cancel_event=cancel,
            ),
        )
        analyze_future = loop.run_in_executor(
            None,
            lambda: analyze_track(audio_path),
        )

        stems = await separate_future

        # Analysis is best-effort — don't fail the job if it errors
        try:
            analysis = await analyze_future
        except Exception:
            analysis = {}

        await progress_queue.put(None)
        await progress_task

        job["status"] = JobStatus.COMPLETED
        job["stems"] = stems
        job["title"] = title
        job["analysis"] = analysis

        await notify_job(job_id, {
            "status": JobStatus.COMPLETED,
            "stems": stems,
            "title": title,
            "analysis": analysis,
        })

    except Exception as e:
        msg = str(e)
        if msg == "Cancelled":
            return
        job["status"] = JobStatus.FAILED
        job["message"] = msg
        await notify_job(job_id, {
            "status": JobStatus.FAILED,
            "message": msg,
        })
    finally:
        cancel_events.pop(job_id, None)



@app.post("/api/youtube", response_model=JobResponse)
async def youtube_download(req: YouTubeRequest):
    job_id = str(uuid.uuid4())[:8]
    job_dir = UPLOADS_DIR / job_id
    job_dir.mkdir(exist_ok=True)

    model = req.model
    cancel_events[job_id] = threading.Event()

    jobs[job_id] = {
        "status": JobStatus.DOWNLOADING,
        "title": "",
        "stems": [],
        "message": "Downloading from YouTube...",
        "audio_path": "",
        "model": model,
    }

    async def download_and_process():
        cancel = cancel_events.get(job_id)
        try:
            # Quickly fetch title from metadata
            loop = asyncio.get_event_loop()
            early_title = await loop.run_in_executor(
                None, lambda: fetch_youtube_title(req.url)
            )
            if early_title:
                jobs[job_id]["title"] = early_title
                await notify_job(job_id, {
                    "status": JobStatus.DOWNLOADING,
                    "message": "Downloading from YouTube...",
                    "progress": None,
                    "title": early_title,
                })
            else:
                await notify_job(job_id, {
                    "status": JobStatus.DOWNLOADING,
                    "message": "Downloading from YouTube...",
                    "progress": None,
                })

            file_path, title = await loop.run_in_executor(
                None,
                lambda: download_youtube(req.url, str(job_dir), cancel_event=cancel),
            )

            jobs[job_id]["title"] = title
            jobs[job_id]["audio_path"] = file_path

            await process_job(job_id, file_path, title, model)

        except Exception as e:
            msg = str(e)
            if msg == "Cancelled":
                return
            jobs[job_id]["status"] = JobStatus.FAILED
            jobs[job_id]["message"] = msg
            await notify_job(job_id, {
                "status": JobStatus.FAILED,
                "message": msg,
            })

    asyncio.create_task(download_and_process())

    return JobResponse(job_id=job_id, status=JobStatus.DOWNLOADING, message="Download started")


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return {"error": "Job not found"}

    # Signal cancellation
    cancel = cancel_events.get(job_id)
    if cancel:
        cancel.set()

    job["status"] = JobStatus.FAILED
    job["message"] = "Cancelled"

    await notify_job(job_id, {
        "status": JobStatus.FAILED,
        "message": "Cancelled",
    })

    # Clean up files
    job_dir = UPLOADS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)

    return {"status": "cancelled"}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    job = jobs.get(job_id)

    # Cancel if still running
    cancel = cancel_events.get(job_id)
    if cancel:
        cancel.set()
    cancel_events.pop(job_id, None)

    # Clean up uploaded files
    job_dir = UPLOADS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)

    # Clean up separated stems
    if job:
        audio_path = job.get("audio_path", "")
        model = job.get("model", "htdemucs_6s")
        if audio_path:
            input_name = Path(audio_path).stem
            stems_dir = SEPARATED_DIR / model / input_name
            if stems_dir.exists():
                shutil.rmtree(stems_dir, ignore_errors=True)

    # Remove from job store
    jobs.pop(job_id, None)

    return {"status": "deleted"}


@app.get("/api/jobs/{job_id}", response_model=JobResult)
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return JobResult(job_id=job_id, status=JobStatus.FAILED, message="Job not found")
    return JobResult(
        job_id=job_id,
        status=job["status"],
        title=job.get("title", ""),
        stems=job.get("stems", []),
        message=job.get("message", ""),
        analysis=job.get("analysis", {}),
    )


@app.get("/api/jobs/{job_id}/stems/{stem_name}")
async def get_stem_file(job_id: str, stem_name: str):
    job = jobs.get(job_id)

    if job:
        audio_path = job.get("audio_path", "")
        model = job.get("model", "htdemucs_6s")
        input_name = Path(audio_path).stem
        stem_file = SEPARATED_DIR / model / input_name / f"{stem_name}.wav"
        if stem_file.exists():
            return FileResponse(str(stem_file), media_type="audio/wav", filename=f"{stem_name}.wav")

    # Fallback: resolve from uploads dir (survives server restart)
    job_dir = UPLOADS_DIR / job_id
    if job_dir.is_dir():
        audio_files = [f for f in job_dir.iterdir() if f.is_file()]
        if audio_files:
            input_name = audio_files[0].stem
            for model_dir in SEPARATED_DIR.iterdir():
                if not model_dir.is_dir():
                    continue
                stem_file = model_dir / input_name / f"{stem_name}.wav"
                if stem_file.exists():
                    return FileResponse(str(stem_file), media_type="audio/wav", filename=f"{stem_name}.wav")

    return {"error": "Stem file not found"}


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()

    if job_id not in ws_connections:
        ws_connections[job_id] = []
    ws_connections[job_id].append(websocket)

    # Send current status immediately
    job = jobs.get(job_id)
    if job:
        await websocket.send_json({
            "status": job["status"],
            "message": job.get("message", ""),
            "stems": job.get("stems", []),
            "title": job.get("title", ""),
        })

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_connections[job_id].remove(websocket)
        if not ws_connections[job_id]:
            del ws_connections[job_id]
