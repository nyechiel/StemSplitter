import subprocess
import os
import re
from pathlib import Path


def separate_stems(
    input_path: str,
    output_dir: str,
    model: str = "htdemucs",
    on_progress: callable = None,
    cancel_event=None,
) -> list[str]:
    """Run demucs to separate audio into stems. Returns list of stem names."""
    process = subprocess.Popen(
        [
            "python3", "-m", "demucs",
            "--out", output_dir,
            "--name", model,
            "-n", model,
            input_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    buffer = b""
    last_pct = -1

    while True:
        if cancel_event and cancel_event.is_set():
            process.terminate()
            process.wait()
            raise RuntimeError("Cancelled")

        chunk = process.stdout.read(1)
        if not chunk:
            break

        if chunk in (b"\r", b"\n"):
            line = buffer.decode("utf-8", errors="replace").strip()
            buffer = b""

            if not line or not on_progress:
                continue

            # Parse percentage from tqdm output like "  6%|████▋   | 5.85/93.6"
            match = re.search(r"(\d+)%\|", line)
            if match:
                pct = int(match.group(1))
                # Only send updates when percentage actually changes
                if pct != last_pct:
                    last_pct = pct
                    on_progress(pct, "")
            elif "Separating track" in line:
                on_progress(0, "Starting separation...")
            elif "Selected model" in line:
                on_progress(0, "Loading model...")
        else:
            buffer += chunk

    process.wait()

    if process.returncode != 0:
        raise RuntimeError("Demucs separation failed")

    # Find output stems
    input_name = Path(input_path).stem
    stems_dir = os.path.join(output_dir, model, input_name)

    if not os.path.isdir(stems_dir):
        raise RuntimeError(f"Output directory not found: {stems_dir}")

    stems = []
    for f in sorted(os.listdir(stems_dir)):
        if f.endswith((".wav", ".mp3", ".flac")):
            stems.append(Path(f).stem)

    return stems
