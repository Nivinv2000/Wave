"""Causal deck-height forecaster.

The concept brief is explicit that the predictor must be separated from the truth
generator so future-information leakage is auditable. This module therefore only
ever sees pad heights that have already been *measured*, and fits a small bank of
sinusoids to that history by least squares - the lightweight fitted predictor the
brief describes.

The window is a fixed number of samples at a fixed rate, so the design matrix is
constant and its pseudo-inverse is computed once at construction. Each update is
then a single matrix-vector product, which is what makes it affordable at every
control step of every training episode.

Nothing here reads ``DeckTrack`` or the wave components. If you ever want to
measure the value of perfect foresight, do it with a separate oracle feature and
label it as an upper bound, not by wiring the truth into this class.
"""

from __future__ import annotations

import numpy as np

#: Basis periods in seconds. These bracket the vessel response periods in
#: deck_motion.Vessel (3.8-10 s) plus a long-swell term, without being told
#: which of them the current sea state actually contains.
DEFAULT_PERIODS = (3.0, 4.0, 5.0, 6.5, 8.0, 10.0, 13.0)


class DeckHeightForecaster:
    """Least-squares sinusoid fit over a sliding window of measured pad height.

    Model, in time ``tau`` relative to the newest sample (``tau = 0``)::

        z(tau) = c0 + c1*tau + sum_j [ a_j cos(w_j tau) + b_j sin(w_j tau) ]

    The linear term absorbs tide and slow drift so the oscillatory terms are not
    forced to explain it.
    """

    def __init__(self, dt: float, window_sec: float = 5.0,
                 periods=DEFAULT_PERIODS, ridge: float = 1e-6):
        if dt <= 0:
            raise ValueError("dt must be positive")
        self.dt = float(dt)
        self.periods = tuple(float(p) for p in periods)
        self.m = max(8, int(round(window_sec / self.dt)))
        self.w = 2.0 * np.pi / np.array(self.periods)

        # tau for the window samples: oldest at -(m-1)*dt, newest at 0.
        tau = (np.arange(self.m) - (self.m - 1)) * self.dt
        self._design = self._basis(tau)                     # [m, k]
        k = self._design.shape[1]
        # Ridge-regularised pseudo-inverse, precomputed once.
        gram = self._design.T @ self._design + ridge * np.eye(k)
        self._pinv = np.linalg.solve(gram, self._design.T)  # [k, m]

        self._buf = np.zeros(self.m)
        self._n = 0
        self._coeff = np.zeros(k)

    # ------------------------------------------------------------------

    def _basis(self, tau: np.ndarray) -> np.ndarray:
        tau = np.atleast_1d(np.asarray(tau, dtype=float))
        cols = [np.ones_like(tau), tau]
        for w in self.w:
            cols.append(np.cos(w * tau))
            cols.append(np.sin(w * tau))
        return np.stack(cols, axis=-1)

    def _basis_derivative(self, tau: np.ndarray) -> np.ndarray:
        tau = np.atleast_1d(np.asarray(tau, dtype=float))
        cols = [np.zeros_like(tau), np.ones_like(tau)]
        for w in self.w:
            cols.append(-w * np.sin(w * tau))
            cols.append(w * np.cos(w * tau))
        return np.stack(cols, axis=-1)

    # ------------------------------------------------------------------

    def reset(self, initial: float = 0.0) -> None:
        self._buf[:] = float(initial)
        self._n = 0
        self._coeff[:] = 0.0

    def push(self, z: float) -> None:
        """Append one measured pad height. Call once per control step.

        Before the window has filled, the buffer is held at the first value, so
        the fit starts out flat rather than fitting a startup transient.
        """
        z = float(z)
        if self._n == 0:
            self._buf[:] = z
        else:
            self._buf[:-1] = self._buf[1:]
            self._buf[-1] = z
        self._n += 1
        self._coeff = self._pinv @ self._buf

    @property
    def ready(self) -> bool:
        """True once a full window of real measurements has been seen."""
        return self._n >= self.m

    def predict(self, horizons) -> tuple[np.ndarray, np.ndarray]:
        """Predicted height and vertical rate at the given horizons, in seconds.

        Horizons are measured forward from the newest pushed sample.
        """
        h = np.atleast_1d(np.asarray(horizons, dtype=float))
        z = self._basis(h) @ self._coeff
        dz = self._basis_derivative(h) @ self._coeff
        return z, dz

    def residual_rms(self) -> float:
        """Fit error over the window; a crude confidence signal."""
        pred = self._design @ self._coeff
        return float(np.sqrt(np.mean((pred - self._buf) ** 2)))
