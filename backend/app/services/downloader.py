import subprocess
import json
import os
import glob as globmod


def fetch_youtube_title(url: str) -> str:
    """Quickly fetch the video title without downloading."""
    try:
        result = subprocess.run(
            ["yt-dlp", "--js-runtimes", "node", "--print", "title", "--no-download", "--no-playlist", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return ""


def download_youtube(url: str, output_dir: str, cancel_event=None) -> tuple[str, str]:
    """Download audio from YouTube URL. Returns (file_path, title)."""
    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")

    # Download with info json to get metadata reliably
    process = subprocess.Popen(
        [
            "yt-dlp",
            "--js-runtimes", "node",
            "--extract-audio",
            "--audio-format", "wav",
            "--audio-quality", "0",
            "--output", output_template,
            "--write-info-json",
            "--no-playlist",
            "--newline",
            url,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Poll for completion, checking cancel event
    while process.poll() is None:
        if cancel_event and cancel_event.is_set():
            process.terminate()
            process.wait()
            raise RuntimeError("Cancelled")
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass

    stdout_text = process.stdout.read() if process.stdout else ""
    stderr_text = process.stderr.read() if process.stderr else ""

    if process.returncode != 0:
        stderr = stderr_text.strip()
        if "not available" in stderr or "is not available" in stderr:
            raise RuntimeError("This video is not available. It may be geo-restricted, age-gated, or removed by the uploader. Try a different video.")
        if "Private video" in stderr:
            raise RuntimeError("This video is private and cannot be accessed.")
        if "Sign in" in stderr or "confirm your age" in stderr:
            raise RuntimeError("This video requires sign-in or age verification and cannot be downloaded.")
        if "not a valid URL" in stderr or "is not a valid URL" in stderr:
            raise RuntimeError("The URL you entered doesn't look like a valid YouTube link. Please check and try again.")
        raise RuntimeError(f"Failed to download video: {stderr}")

    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Cancelled")

    # Get title from the info json file
    title = "Unknown"
    info_files = globmod.glob(os.path.join(output_dir, "*.info.json"))
    if info_files:
        with open(info_files[0]) as f:
            info = json.load(f)
            title = info.get("title", "Unknown")
        os.remove(info_files[0])

    # Find the audio file (could be .wav, .opus, .m4a, etc.)
    audio_files = [
        f for f in globmod.glob(os.path.join(output_dir, "*"))
        if not f.endswith(".json") and os.path.isfile(f)
    ]

    if not audio_files:
        raise RuntimeError(
            f"No audio file found after download. "
            f"stdout: {stdout_text.strip()} | "
            f"stderr: {stderr_text.strip()}"
        )

    return audio_files[0], title
