# Wave — Ocean Flight Lab

A local ship-deck landing simulator for testing drone controller models, with a 3D ocean, six-axis vessel response, quadrotor dynamics, imperfect sensors, and a live dashboard.

## Run the current simulator

```sh
cd work/ocean-flight-lab
npm start
```

Open **http://127.0.0.1:4180**. Node.js 20+ and a WebGL-capable browser are required. No npm install, cloud API, or physical drone is needed. The rendering library is vendored locally.

Use the built-in controllers, upload a JavaScript module, or run the Python adapter:

```sh
python3 examples/python_controller.py
```

Choose **Python / HTTP model** in the dashboard to attach that local service.

## Start here

- [Simulator guide](work/ocean-flight-lab/README.md): usage, all parameters, model contract, sensors, physics, and limitations.
- [Build status and next steps](BUILD_STATUS.md): the current checkpoint and remaining engineering work.
- [First-principles concept brief](outputs/ADVERSARIAL_FLIGHT_LAB_MASTER_BRIEF.md): problem statement, proposed self-improvement loop, data sources, and SMAF extension.
- [Dataset and idea PDF](output/pdf/drone-airspace-ideas-and-data.pdf).
- [Test results across six weather presets](work/ocean-flight-lab/reports/weather-matrix.json).
- [Change history](CHANGELOG.md).

The older `work/last-safe-second` prototype and documents in `outputs/` are retained as project history. Their statements about what was implemented describe earlier checkpoints; use `BUILD_STATUS.md` and the current simulator guide for present capabilities.

## Scope

This is a reduced-order engineering environment, not a vessel-calibrated digital twin. The drone responds to controller commands through dynamics and imperfect measurements; the vessel response and sensor constants are illustrative. Matching a particular real ship/aircraft requires identification and validation data. PX4/Gazebo integration, model training, autonomous policy improvement, and SMAF are not implemented in this checkpoint.

The repository includes a vendored copy of Three.js under its MIT license at `work/ocean-flight-lab/public/vendor/THREE-LICENSE.txt`. No license has been selected for the original project code.
