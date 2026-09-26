"""The three deck-landing scenarios, hardcoded.

Each scenario bundles three things that have to agree with each other:

* ``sea``     - the prescribed ship motion and wind, written into the Gazebo world
                and executed by gz/plugin/ShipWaveMotion.cc;
* ``look``    - sky, light and water colours for the rendered world;
* ``landing`` - the hardcoded landing law flown by bridge/land_on_deck.py.

The sea states are illustrative, not calibrated to a particular vessel: heave,
roll and pitch amplitudes are chosen to be clearly distinct and roughly in line
with a small ship in the named conditions. The landing laws get more patient and
more conservative as the sea gets worse - a narrower deck-motion window before
committing, slower final creep, earlier abort.
"""

# Pad centre in the ship frame (x forward, y left, z up), metres. The hull's
# collision box top is at z = 2.5, so this is the deck surface.
PAD_OFFSET = (-8.0, 0.0, 2.5)
PAD_RADIUS = 3.2

# Static launch platform the drone starts on: xy centre and top-surface height.
LAUNCH_PAD_XY = (0.0, 20.0)
LAUNCH_PAD_TOP = 1.0

# Place the ship so its pad passes abeam the launch platform roughly this long
# after the simulation starts, which is about how long PX4 takes to be ready
# to arm. If PX4 is quicker or slower the drone simply chases further.
SHIP_MEET_TIME_S = 35.0

SHIP_MODEL = "ship"
DRONE_MODEL = "x500_0"

SCENARIOS = {
    "light": {
        "label": "Light breeze",
        "world": "ship_light",
        "sea": dict(
            speed=1.0, heading_deg=0.0,
            heave_amp=0.15, heave_period=6.0,
            roll_amp_deg=1.5, roll_period=7.0,
            pitch_amp_deg=0.8, pitch_period=5.5,
            yaw_amp_deg=0.5, yaw_period=12.0,
            irregularity=0.2, seed=11,
            wind_speed=3.0, wind_dir_deg=30.0, gust_std=0.5, gust_tau=2.5,
            wind_drag=0.35,
        ),
        "look": dict(
            sky=(0.62, 0.76, 0.92), ambient=(0.55, 0.55, 0.60),
            sun=1.0, water=(0.04, 0.30, 0.52),
        ),
        "landing": dict(
            cruise_alt=4.0, approach_speed=6.0, align_radius=1.2, descend_speed=1.8, final_height=1.0, creep_speed=0.6, gate_vz=1.0, gate_tilt=0.15, abort_radius=2.4, kp_xy=1.6, lead=0.3, cut_margin=0.12,
        ),
    },
    "medium": {
        "label": "Moderate sea",
        "world": "ship_medium",
        "sea": dict(
            speed=1.5, heading_deg=0.0,
            heave_amp=0.5, heave_period=7.0,
            roll_amp_deg=4.0, roll_period=8.0,
            pitch_amp_deg=2.0, pitch_period=6.0,
            yaw_amp_deg=1.0, yaw_period=14.0,
            irregularity=0.35, seed=23,
            wind_speed=7.0, wind_dir_deg=40.0, gust_std=1.5, gust_tau=2.0,
            wind_drag=0.35,
        ),
        "look": dict(
            sky=(0.52, 0.58, 0.64), ambient=(0.42, 0.42, 0.46),
            sun=0.75, water=(0.05, 0.21, 0.33),
        ),
        "landing": dict(
            cruise_alt=4.5, approach_speed=6.0, align_radius=1.3, descend_speed=1.6, final_height=1.2, creep_speed=0.6, gate_vz=0.8, gate_tilt=0.12, abort_radius=2.5, kp_xy=1.8, lead=0.35, cut_margin=0.12,
        ),
    },
    "storm": {
        "label": "Heavy storm",
        "world": "ship_storm",
        "sea": dict(
            speed=2.0, heading_deg=0.0,
            heave_amp=1.1, heave_period=8.5,
            roll_amp_deg=8.0, roll_period=9.5,
            pitch_amp_deg=3.5, pitch_period=7.0,
            yaw_amp_deg=2.0, yaw_period=16.0,
            irregularity=0.5, seed=37,
            wind_speed=11.0, wind_dir_deg=55.0, gust_std=3.0, gust_tau=1.6,
            wind_drag=0.35,
        ),
        "look": dict(
            sky=(0.24, 0.26, 0.30), ambient=(0.30, 0.30, 0.34),
            sun=0.45, water=(0.06, 0.12, 0.16),
        ),
        "landing": dict(
            cruise_alt=5.0, approach_speed=7.0, align_radius=1.5, descend_speed=1.6, final_height=1.5, creep_speed=0.7, gate_vz=0.7, gate_tilt=0.14, abort_radius=2.6, kp_xy=2.0, lead=0.4, cut_margin=0.15,
        ),
    },
}
