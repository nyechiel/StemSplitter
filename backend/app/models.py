from pydantic import BaseModel
from enum import Enum


class JobStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    SEPARATING = "separating"
    COMPLETED = "completed"
    FAILED = "failed"


class YouTubeRequest(BaseModel):
    url: str
    model: str = "htdemucs_6s"


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str = ""


class JobResult(BaseModel):
    job_id: str
    status: JobStatus
    title: str = ""
    stems: list[str] = []
    message: str = ""
    analysis: dict = {}
