import librosa
import numpy as np


KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def analyze_track(file_path: str) -> dict:
    """Analyze audio file for tempo, key, and other musical properties."""
    y, sr = librosa.load(file_path, sr=None, mono=True)

    # Tempo / BPM
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = round(float(np.atleast_1d(tempo)[0]))

    # Key detection using chroma features
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_avg = np.mean(chroma, axis=1)

    # Krumhansl-Schmuckler key profiles
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    best_corr = -1
    best_key = 0
    best_mode = "major"

    for i in range(12):
        rotated = np.roll(chroma_avg, -i)
        major_corr = np.corrcoef(rotated, major_profile)[0, 1]
        minor_corr = np.corrcoef(rotated, minor_profile)[0, 1]

        if major_corr > best_corr:
            best_corr = major_corr
            best_key = i
            best_mode = "major"
        if minor_corr > best_corr:
            best_corr = minor_corr
            best_key = i
            best_mode = "minor"

    key = f"{KEY_NAMES[best_key]} {best_mode}"

    # Duration
    duration = round(librosa.get_duration(y=y, sr=sr), 1)

    # Time signature estimation via onset strength autocorrelation
    time_sig = "4/4"
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    hop_length = 512  # librosa default
    frame_rate = sr / hop_length  # frames per second

    # Get the beat period in seconds from tempo
    beat_period_sec = 60.0 / bpm
    beat_period_frames = beat_period_sec * frame_rate

    # Autocorrelate onset envelope at lags corresponding to measures of N beats
    # Use Pearson correlation for proper [-1, 1] normalization (avoids short-lag bias)
    onset_centered = onset_env - np.mean(onset_env)
    n = len(onset_centered)
    std_val = np.std(onset_env)
    candidates = {3: "3/4", 4: "4/4", 5: "5/4", 6: "6/8", 7: "7/8"}
    scores = {}

    for num_beats, sig in candidates.items():
        measure_lag = int(round(beat_period_frames * num_beats))
        if measure_lag >= n // 2:
            continue
        score = 0
        count = 0
        for mult in range(1, 4):
            lag = measure_lag * mult
            if lag >= n:
                break
            seg_a = onset_env[:n - lag]
            seg_b = onset_env[lag:]
            std_a = np.std(seg_a)
            std_b = np.std(seg_b)
            if std_a > 0 and std_b > 0:
                corr = np.corrcoef(seg_a, seg_b)[0, 1]
                score += corr
                count += 1
        if count > 0:
            scores[sig] = score / count

    # 4/4 is the most common meter — only pick a different one if its
    # Pearson correlation is meaningfully higher
    if scores:
        base_score = scores.get("4/4", 0)
        time_sig = "4/4"
        best_alt_score = 0
        for sig, score in scores.items():
            if sig == "4/4":
                continue
            if score > base_score + 0.05 and score > best_alt_score:
                best_alt_score = score
                time_sig = sig

    # Chord detection using chroma features
    # Use beat-synchronous chroma for cleaner chord boundaries
    beat_frames = librosa.beat.beat_track(y=y, sr=sr)[1]
    chroma_sync = librosa.feature.chroma_cqt(y=y, sr=sr)

    # If we have beats, aggregate chroma per beat for cleaner results
    # librosa.util.sync returns len(beat_frames)+1 columns, so prepend time=0
    if len(beat_frames) > 1:
        chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
        chord_times = [0.0] + librosa.frames_to_time(beat_frames, sr=sr).tolist()
    else:
        # Fallback: use fixed-size frames (~0.5s each)
        hop_frames = max(1, int(0.5 * sr / 512))
        indices = np.arange(0, chroma.shape[1], hop_frames)
        chroma_sync = librosa.util.sync(chroma, indices, aggregate=np.median)
        chord_times = [0.0] + librosa.frames_to_time(indices, sr=sr).tolist()

    # Chord templates: major, minor for each root
    chord_templates = {}
    for i, name in enumerate(KEY_NAMES):
        # Major triad: root, major third (+4), fifth (+7)
        major = np.zeros(12)
        major[i] = 1.0
        major[(i + 4) % 12] = 1.0
        major[(i + 7) % 12] = 1.0
        chord_templates[name] = major

        # Minor triad: root, minor third (+3), fifth (+7)
        minor = np.zeros(12)
        minor[i] = 1.0
        minor[(i + 3) % 12] = 1.0
        minor[(i + 7) % 12] = 1.0
        chord_templates[f"{name}m"] = minor

    # Match each beat's chroma to best chord template
    chords = []
    for frame_idx in range(chroma_sync.shape[1]):
        t = chord_times[frame_idx] if frame_idx < len(chord_times) else chord_times[-1]
        frame = chroma_sync[:, frame_idx]
        if np.max(frame) < 0.01:
            chords.append({"time": t, "chord": "N"})
            continue
        frame_norm = frame / (np.linalg.norm(frame) + 1e-10)
        best_chord = "N"
        best_score = -1
        for chord_name, template in chord_templates.items():
            template_norm = template / (np.linalg.norm(template) + 1e-10)
            score = np.dot(frame_norm, template_norm)
            if score > best_score:
                best_score = score
                best_chord = chord_name
        chords.append({"time": t, "chord": best_chord})

    # Collapse consecutive identical chords
    collapsed_chords = []
    for entry in chords:
        if collapsed_chords and collapsed_chords[-1]["chord"] == entry["chord"]:
            continue
        collapsed_chords.append(entry)

    return {
        "bpm": bpm,
        "key": key,
        "duration": duration,
        "time_signature": time_sig,
        "chords": collapsed_chords,
    }
