import numpy as np

from app.dsp.modes import Mode
from app.dsp.resynth import resynthesize


def test_resynthesize_produces_audio():
    modes = [Mode(f=523.3, d=1.8, a=1.0), Mode(f=1247.1, d=3.2, a=0.6)]
    y = resynthesize(modes, sr=44100, duration=1.0)
    assert y.shape == (44100,)
    assert np.max(np.abs(y)) <= 1.0


def test_app_imports():
    from app.main import app  # noqa: F401
