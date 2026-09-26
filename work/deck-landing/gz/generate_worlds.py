#!/usr/bin/env python3
"""Write the three Gazebo worlds (ship_light / ship_medium / ship_storm).

Each world is self-contained: rendered ocean, a fixed launch platform for the
drone, and a ship whose ShipWaveMotion plugin carries that scenario's hardcoded
sea state and wind from ../scenarios.py.

The worlds deliberately contain no world-level <plugin> elements. PX4 supplies
physics and sensor systems through its server.config, which Gazebo only applies
to worlds without world-level plugins.

Usage: python3 generate_worlds.py [output_dir]   (default: ./worlds)
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from scenarios import (  # noqa: E402
    LAUNCH_PAD_TOP,
    LAUNCH_PAD_XY,
    PAD_OFFSET,
    SCENARIOS,
    SHIP_MEET_TIME_S,
    SHIP_MODEL,
)


def rgba(c, a=1.0):
    return "%.3f %.3f %.3f %.3f" % (c[0], c[1], c[2], a)


def material(c, spec=0.2):
    return (
        "<material><ambient>%s</ambient><diffuse>%s</diffuse>"
        "<specular>%s</specular></material>" % (rgba(c), rgba(c), rgba((spec, spec, spec)))
    )


def box_visual(name, pose, size, color, spec=0.2):
    return (
        '<visual name="%s"><pose>%s</pose><geometry><box><size>%s</size></box>'
        "</geometry>%s</visual>" % (name, pose, size, material(color, spec))
    )


def cyl_visual(name, pose, radius, length, color, spec=0.2):
    return (
        '<visual name="%s"><pose>%s</pose><geometry><cylinder><radius>%g</radius>'
        "<length>%g</length></cylinder></geometry>%s</visual>"
        % (name, pose, radius, length, material(color, spec))
    )


def box_collision(name, pose, size, mu=1.2):
    return (
        '<collision name="%s"><pose>%s</pose><geometry><box><size>%s</size></box>'
        "</geometry><surface><friction><ode><mu>%g</mu><mu2>%g</mu2></ode>"
        "</friction></surface></collision>" % (name, pose, size, mu, mu)
    )


def ship_model(sea):
    """Inline ship: hull, pointed bow, bridge, mast, funnel and an aft helideck.

    Ship frame: x forward, y to port, z up, origin at the waterline amidships.
    The hull box top (the deck) is at z = 2.5, matching PAD_OFFSET.
    """
    px, py, pz = PAD_OFFSET
    speed = sea["speed"]
    heading = math.radians(sea["heading_deg"])
    # Start so the pad passes abeam the launch platform at about SHIP_MEET_TIME_S.
    along = -px - speed * SHIP_MEET_TIME_S
    x0 = LAUNCH_PAD_XY[0] + along * math.cos(heading)
    y0 = along * math.sin(heading)

    hull = (0.16, 0.19, 0.24)
    deck = (0.42, 0.44, 0.46)
    white = (0.92, 0.92, 0.90)
    red = (0.70, 0.12, 0.10)
    yellow = (0.95, 0.80, 0.10)
    pad = (0.18, 0.19, 0.20)
    glass = (0.08, 0.10, 0.14)

    parts = [
        # Hull and bow. The bow is a square rotated 45 deg whose diagonal equals
        # the beam, which gives a pointed stem that meets the hull sides.
        box_collision("hull_c", "-2 0 0 0 0 0", "26 8 5"),
        box_visual("hull_v", "-2 0 0 0 0 0", "26 8 5", hull, 0.3),
        box_collision("bow_c", "11 0 0 0 0 0.785398", "5.657 5.657 5"),
        box_visual("bow_v", "11 0 0 0 0 0.785398", "5.657 5.657 5", hull, 0.3),
        box_visual("deck_v", "-2 0 2.505 0 0 0", "25.9 7.8 0.01", deck, 0.1),
        # Bridge, windows, funnel, mast.
        box_collision("bridge_c", "4 0 4.5 0 0 0", "7 6.5 4"),
        box_visual("bridge_v", "4 0 4.5 0 0 0", "7 6.5 4", white, 0.4),
        box_visual("windows_v", "7.53 0 5.6 0 0 0", "0.06 5.6 0.8", glass, 0.9),
        box_visual("funnel_v", "1.6 0 7.4 0 0 0", "1.8 1.8 1.8", red, 0.3),
        cyl_visual("mast_v", "5 0 9.0 0 0 0", 0.12, 5.0, white),
        # Helideck: dark disc, yellow ring, white H.
        cyl_visual("pad_v", "%g %g %g 0 0 0" % (px, py, pz + 0.012), 3.4, 0.01, pad, 0.1),
        cyl_visual("ring_v", "%g %g %g 0 0 0" % (px, py, pz + 0.018), 3.2, 0.01, yellow, 0.2),
        cyl_visual("ring_in_v", "%g %g %g 0 0 0" % (px, py, pz + 0.024), 2.9, 0.01, pad, 0.1),
        box_visual("h_l_v", "%g %g %g 0 0 0" % (px, py + 0.65, pz + 0.03), "1.8 0.3 0.01", white),
        box_visual("h_r_v", "%g %g %g 0 0 0" % (px, py - 0.65, pz + 0.03), "1.8 0.3 0.01", white),
        box_visual("h_x_v", "%g %g %g 0 0 0" % (px, py, pz + 0.03), "0.3 1.0 0.01", white),
    ]

    plugin_keys = [
        "speed", "heave_amp", "heave_period", "roll_amp_deg", "roll_period",
        "pitch_amp_deg", "pitch_period", "yaw_amp_deg", "yaw_period",
        "irregularity", "seed", "wind_speed", "wind_dir_deg", "gust_std",
        "gust_tau", "wind_drag",
    ]
    plugin = "\n".join(
        "        <%s>%s</%s>" % (k, sea[k], k) for k in plugin_keys
    )

    return """    <model name="%s">
      <pose>%.3f %.3f 0 0 0 %.6f</pose>
      <link name="hull">
        <gravity>false</gravity>
        <inertial>
          <mass>200000</mass>
          <inertia>
            <ixx>1.5e6</ixx><ixy>0</ixy><ixz>0</ixz>
            <iyy>1.2e7</iyy><iyz>0</iyz><izz>1.2e7</izz>
          </inertia>
        </inertial>
        %s
      </link>
      <plugin filename="ShipWaveMotion" name="deck::ShipWaveMotion">
%s
        <wind_target>x500_0</wind_target>
      </plugin>
    </model>""" % (SHIP_MODEL, x0, y0, heading, "\n        ".join(parts), plugin)


def world(name, scen):
    look = scen["look"]
    lx, ly = LAUNCH_PAD_XY
    top = LAUNCH_PAD_TOP
    return """<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by gz/generate_worlds.py from scenarios.py - edit those, not this.
     Scenario: %(label)s. Water is rendered only (no hydrodynamics); the ship's
     motion is prescribed by the ShipWaveMotion plugin. -->
<sdf version="1.9">
  <world name="%(name)s">
    <physics type="ode">
      <max_step_size>0.004</max_step_size>
      <real_time_factor>1.0</real_time_factor>
      <real_time_update_rate>250</real_time_update_rate>
    </physics>
    <gravity>0 0 -9.8</gravity>
    <magnetic_field>6e-06 2.3e-05 -4.2e-05</magnetic_field>
    <atmosphere type="adiabatic"/>
    <scene>
      <grid>false</grid>
      <ambient>%(ambient)s</ambient>
      <background>%(sky)s</background>
      <shadows>true</shadows>
    </scene>

    <model name="ocean">
      <static>true</static>
      <link name="surface">
        <visual name="water">
          <cast_shadows>false</cast_shadows>
          <geometry><plane><normal>0 0 1</normal><size>4000 4000</size></plane></geometry>
          <material>
            <ambient>%(water)s</ambient>
            <diffuse>%(water)s</diffuse>
            <specular>0.7 0.7 0.7 1</specular>
            <pbr><metal><metalness>0.0</metalness><roughness>0.12</roughness></metal></pbr>
          </material>
        </visual>
      </link>
    </model>

    <model name="seabed">
      <static>true</static>
      <pose>0 0 -40 0 0 0</pose>
      <link name="link">
        <collision name="bottom">
          <geometry><plane><normal>0 0 1</normal><size>4000 4000</size></plane></geometry>
        </collision>
      </link>
    </model>

    <model name="launch_pad">
      <static>true</static>
      <pose>%(lx)g %(ly)g %(lz)g 0 0 0</pose>
      <link name="link">
        <collision name="c">
          <geometry><box><size>4 4 %(lh)g</size></box></geometry>
          <surface><friction><ode><mu>1.2</mu><mu2>1.2</mu2></ode></friction></surface>
        </collision>
        <visual name="v">
          <geometry><box><size>4 4 %(lh)g</size></box></geometry>
          <material><ambient>0.85 0.45 0.10 1</ambient><diffuse>0.85 0.45 0.10 1</diffuse></material>
        </visual>
      </link>
    </model>

%(ship)s

    <light name="sun" type="directional">
      <pose>0 0 500 0 0 0</pose>
      <cast_shadows>true</cast_shadows>
      <intensity>%(sun)g</intensity>
      <direction>0.3 0.5 -0.8</direction>
      <diffuse>0.9 0.9 0.9 1</diffuse>
      <specular>0.3 0.3 0.3 1</specular>
    </light>

    <spherical_coordinates>
      <surface_model>EARTH_WGS84</surface_model>
      <world_frame_orientation>ENU</world_frame_orientation>
      <latitude_deg>47.397971057728974</latitude_deg>
      <longitude_deg>8.546163739800146</longitude_deg>
      <elevation>0</elevation>
    </spherical_coordinates>
  </world>
</sdf>
""" % dict(
        name=name, label=scen["label"],
        ambient=rgba(look["ambient"]), sky=rgba(look["sky"]),
        water=rgba(look["water"]), sun=look["sun"],
        lx=lx, ly=ly, lz=top / 2.0, lh=top,
        ship=ship_model(scen["sea"]),
    )


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "worlds")
    os.makedirs(out, exist_ok=True)
    for key, scen in SCENARIOS.items():
        path = os.path.join(out, scen["world"] + ".sdf")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(world(scen["world"], scen))
        print("wrote", path)


if __name__ == "__main__":
    main()
