cmake_minimum_required(VERSION 3.16)
project(ShipWaveMotion LANGUAGES CXX)

# Gazebo Harmonic (gz-sim 8), which is what PX4's gz_x500 target runs here.
find_package(gz-plugin2 REQUIRED COMPONENTS register)
find_package(gz-sim8 REQUIRED)

add_library(ShipWaveMotion SHARED ShipWaveMotion.cc)
set_property(TARGET ShipWaveMotion PROPERTY CXX_STANDARD 17)
target_link_libraries(ShipWaveMotion PRIVATE
  gz-plugin2::register
  gz-sim8::gz-sim8)
