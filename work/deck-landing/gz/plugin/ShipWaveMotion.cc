/*
 * ShipWaveMotion - moves a ship model through a hardcoded sea state, and blows
 * a gusty wind on the drone, for the three deck-landing scenarios.
 *
 * This is a prescribed (non-hydrodynamic) motion: the water is only rendered.
 * Heave, roll, pitch and yaw are each a sum of three sinusoids at incommensurate
 * periods, so the deck never settles into a perfectly regular rhythm a landing
 * law could time trivially. The ship also steams forward at a constant speed on
 * the heading of its initial SDF pose.
 *
 * The motion is imposed with model velocity commands (feedforward from the
 * analytic trajectory plus a small pose-error correction), the same mechanism as
 * gz-sim's VelocityControl system. The hull is therefore a real moving rigid
 * body: a drone resting on the deck is carried by contact friction, which a
 * teleported (pose-set) deck would not do.
 *
 * Wind is applied as a linear drag force on the drone's base_link toward the
 * air velocity (mean wind plus an Ornstein-Uhlenbeck gust per axis). It lives in
 * this model-level plugin on purpose: PX4 loads its sensor and physics systems
 * from server.config, which only applies when the world file has no world-level
 * plugins, so a world-level WindEffects plugin would switch those off.
 *
 * All parameters are optional SDF children of the <plugin> element; see the
 * defaults in Configure(). Units: metres, seconds, degrees where named *_deg.
 */

#include <chrono>
#include <cmath>
#include <memory>
#include <random>
#include <string>

#include <gz/common/Console.hh>
#include <gz/math/Pose3.hh>
#include <gz/math/Quaternion.hh>
#include <gz/math/Vector3.hh>
#include <gz/plugin/Register.hh>
#include <gz/sim/EntityComponentManager.hh>
#include <gz/sim/EventManager.hh>
#include <gz/sim/Link.hh>
#include <gz/sim/Model.hh>
#include <gz/sim/System.hh>
#include <gz/sim/Util.hh>
#include <gz/sim/World.hh>
#include <gz/sim/components/AngularVelocityCmd.hh>
#include <gz/sim/components/LinearVelocityCmd.hh>
#include <sdf/Element.hh>

namespace deck
{

/// One motion axis: three sinusoids, main + two irregular companions.
struct WaveAxis
{
  double amp[3]{0.0, 0.0, 0.0};
  double w[3]{1.0, 1.0, 1.0};
  double phase[3]{0.0, 0.0, 0.0};

  void Init(double _amp, double _period, double _irregularity, std::mt19937 &_rng)
  {
    std::uniform_real_distribution<double> ph(0.0, 2.0 * GZ_PI);
    const double period = _period > 0.1 ? _period : 0.1;
    // Incommensurate companions at 1.37x and 0.71x the main period.
    const double periods[3] = {period, period * 1.37, period * 0.71};
    const double amps[3] = {_amp, _amp * 0.6 * _irregularity, _amp * 0.4 * _irregularity};
    for (int i = 0; i < 3; ++i)
    {
      this->amp[i] = amps[i];
      this->w[i] = 2.0 * GZ_PI / periods[i];
      this->phase[i] = ph(_rng);
    }
  }

  double Value(double _t) const
  {
    double v = 0.0;
    for (int i = 0; i < 3; ++i)
      v += this->amp[i] * std::sin(this->w[i] * _t + this->phase[i]);
    return v;
  }

  double Rate(double _t) const
  {
    double v = 0.0;
    for (int i = 0; i < 3; ++i)
      v += this->amp[i] * this->w[i] * std::cos(this->w[i] * _t + this->phase[i]);
    return v;
  }
};

class ShipWaveMotion : public gz::sim::System,
                       public gz::sim::ISystemConfigure,
                       public gz::sim::ISystemPreUpdate
{
public:
  void Configure(const gz::sim::Entity &_entity,
                 const std::shared_ptr<const sdf::Element> &_sdf,
                 gz::sim::EntityComponentManager &_ecm,
                 gz::sim::EventManager &) override
  {
    this->model = gz::sim::Model(_entity);
    if (!this->model.Valid(_ecm))
    {
      gzerr << "ShipWaveMotion must be attached to a model\n";
      return;
    }

    auto get = [&](const char *_name, double _default) {
      return _sdf->HasElement(_name) ? _sdf->Get<double>(_name) : _default;
    };

    this->speed = get("speed", 1.0);
    const double irregularity = get("irregularity", 0.3);
    const unsigned seed = static_cast<unsigned>(get("seed", 7));
    std::mt19937 rng(seed);

    this->heave.Init(get("heave_amp", 0.3), get("heave_period", 7.0), irregularity, rng);
    this->roll.Init(GZ_DTOR(get("roll_amp_deg", 2.0)), get("roll_period", 8.0), irregularity, rng);
    this->pitch.Init(GZ_DTOR(get("pitch_amp_deg", 1.0)), get("pitch_period", 6.0), irregularity, rng);
    this->yaw.Init(GZ_DTOR(get("yaw_amp_deg", 0.5)), get("yaw_period", 14.0), irregularity, rng);

    this->windMean = gz::math::Vector3d(
      get("wind_speed", 0.0) * std::cos(GZ_DTOR(get("wind_dir_deg", 0.0))),
      get("wind_speed", 0.0) * std::sin(GZ_DTOR(get("wind_dir_deg", 0.0))),
      0.0);
    this->gustStd = get("gust_std", 0.0);
    this->gustTau = std::max(0.2, get("gust_tau", 2.0));
    this->windDrag = get("wind_drag", 0.35);
    this->windTarget = _sdf->HasElement("wind_target")
      ? _sdf->Get<std::string>("wind_target") : std::string("x500_0");
    this->gustRng.seed(seed * 7919u + 13u);

    const gz::math::Pose3d start = gz::sim::worldPose(_entity, _ecm);
    this->origin = start.Pos();
    this->heading = start.Rot().Yaw();

    gzmsg << "[ShipWaveMotion] speed " << this->speed << " m/s heading "
          << GZ_RTOD(this->heading) << " deg, heave " << get("heave_amp", 0.3)
          << " m / " << get("heave_period", 7.0) << " s, roll "
          << get("roll_amp_deg", 2.0) << " deg, pitch " << get("pitch_amp_deg", 1.0)
          << " deg, wind " << this->windMean.Length() << " m/s gust sd "
          << this->gustStd << "\n";
  }

  void PreUpdate(const gz::sim::UpdateInfo &_info,
                 gz::sim::EntityComponentManager &_ecm) override
  {
    if (_info.paused || !this->model.Valid(_ecm))
      return;

    const double t = std::chrono::duration<double>(_info.simTime).count();
    const double dt = std::chrono::duration<double>(_info.dt).count();
    const gz::sim::Entity entity = this->model.Entity();

    // ---- Desired pose and twist from the analytic sea state.
    const gz::math::Vector3d dir(std::cos(this->heading), std::sin(this->heading), 0.0);
    const gz::math::Vector3d pDes =
      this->origin + dir * (this->speed * t) + gz::math::Vector3d(0, 0, this->heave.Value(t));
    const gz::math::Vector3d vDes =
      dir * this->speed + gz::math::Vector3d(0, 0, this->heave.Rate(t));

    const double r = this->roll.Value(t);
    const double p = this->pitch.Value(t);
    const double y = this->heading + this->yaw.Value(t);
    const double rd = this->roll.Rate(t);
    const double pd = this->pitch.Rate(t);
    const double yd = this->yaw.Rate(t);
    const gz::math::Quaterniond qDes(r, p, y);
    // Exact ZYX Euler-rate to world angular velocity mapping.
    const gz::math::Vector3d wDes(
      rd * std::cos(y) * std::cos(p) - pd * std::sin(y),
      rd * std::sin(y) * std::cos(p) + pd * std::cos(y),
      yd - rd * std::sin(p));

    if (!this->placed)
    {
      // Start exactly on the trajectory instead of converging onto it.
      this->model.SetWorldPoseCmd(_ecm, gz::math::Pose3d(pDes, qDes));
      this->placed = true;
    }

    // ---- Feedforward plus a small pose correction, commanded as velocity.
    const gz::math::Pose3d cur = gz::sim::worldPose(entity, _ecm);
    const gz::math::Vector3d vCmd = vDes + 2.0 * (pDes - cur.Pos());

    gz::math::Quaterniond qErr = qDes * cur.Rot().Inverse();
    qErr.Normalize();
    if (qErr.W() < 0.0)
      qErr = gz::math::Quaterniond(-qErr.W(), -qErr.X(), -qErr.Y(), -qErr.Z());
    const gz::math::Vector3d wCmd =
      wDes + 2.0 * 2.0 * gz::math::Vector3d(qErr.X(), qErr.Y(), qErr.Z());

    // The physics system rotates model velocity commands from the model frame
    // into the world frame, so hand it model-frame vectors.
    const gz::math::Vector3d vBody = cur.Rot().RotateVectorReverse(vCmd);
    const gz::math::Vector3d wBody = cur.Rot().RotateVectorReverse(wCmd);

    auto *lin = _ecm.Component<gz::sim::components::LinearVelocityCmd>(entity);
    if (lin == nullptr)
      _ecm.CreateComponent(entity, gz::sim::components::LinearVelocityCmd({vBody}));
    else
      *lin = gz::sim::components::LinearVelocityCmd({vBody});

    auto *ang = _ecm.Component<gz::sim::components::AngularVelocityCmd>(entity);
    if (ang == nullptr)
      _ecm.CreateComponent(entity, gz::sim::components::AngularVelocityCmd({wBody}));
    else
      *ang = gz::sim::components::AngularVelocityCmd({wBody});

    this->ApplyWind(_ecm, dt);
  }

private:
  void ApplyWind(gz::sim::EntityComponentManager &_ecm, double _dt)
  {
    if (this->windMean.Length() < 1e-6 && this->gustStd < 1e-6)
      return;

    if (this->droneLink == gz::sim::kNullEntity)
    {
      // The drone is spawned by PX4 after the world starts; look until it exists.
      const gz::sim::World world(gz::sim::worldEntity(_ecm));
      const gz::sim::Entity drone = world.ModelByName(_ecm, this->windTarget);
      if (drone == gz::sim::kNullEntity)
        return;
      this->droneLink = gz::sim::Model(drone).LinkByName(_ecm, "base_link");
      if (this->droneLink == gz::sim::kNullEntity)
        return;
      gz::sim::Link(this->droneLink).EnableVelocityChecks(_ecm, true);
      gzmsg << "[ShipWaveMotion] applying wind to " << this->windTarget << "\n";
    }

    // Ornstein-Uhlenbeck gust per axis; vertical gusts are weaker.
    std::normal_distribution<double> n01(0.0, 1.0);
    if (_dt > 0.0)
    {
      const double k = this->gustStd * std::sqrt(2.0 * _dt / this->gustTau);
      this->gust.X() += -this->gust.X() / this->gustTau * _dt + k * n01(this->gustRng);
      this->gust.Y() += -this->gust.Y() / this->gustTau * _dt + k * n01(this->gustRng);
      this->gust.Z() += -this->gust.Z() / this->gustTau * _dt + 0.3 * k * n01(this->gustRng);
    }

    gz::sim::Link link(this->droneLink);
    const auto vel = link.WorldLinearVelocity(_ecm);
    const gz::math::Vector3d air = this->windMean + this->gust;
    const gz::math::Vector3d rel = air - (vel ? *vel : gz::math::Vector3d::Zero);
    const gz::math::Vector3d force(
      this->windDrag * rel.X(), this->windDrag * rel.Y(), 0.5 * this->windDrag * rel.Z());
    link.AddWorldForce(_ecm, force);
  }

  gz::sim::Model model{gz::sim::kNullEntity};
  gz::math::Vector3d origin;
  double heading{0.0};
  double speed{1.0};
  bool placed{false};
  WaveAxis heave, roll, pitch, yaw;

  gz::math::Vector3d windMean;
  gz::math::Vector3d gust;
  double gustStd{0.0};
  double gustTau{2.0};
  double windDrag{0.35};
  std::string windTarget;
  std::mt19937 gustRng;
  gz::sim::Entity droneLink{gz::sim::kNullEntity};
};

}  // namespace deck

GZ_ADD_PLUGIN(deck::ShipWaveMotion,
              gz::sim::System,
              deck::ShipWaveMotion::ISystemConfigure,
              deck::ShipWaveMotion::ISystemPreUpdate)
