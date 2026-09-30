# Office 3D Convention Center & Hyperloop

The Office tab's city view is themed as Los Angeles: the office block wears the Los Angeles Convention Center, and a hyperloop line runs above the north road.

## Convention center exterior

[[src/renderer/src/screens/Office/office3d/objects/ConventionCenter.tsx#ConventionCenterExterior]] adds exterior skin only — a teal parapet ring, the LOS ANGELES CONVENTION CENTER fascia sign (canvas texture), a steel entrance canopy over the south door, instanced aluminium fins on the flanks, rooftop plant, corner flagpoles and a palm-lined forecourt. The interior walls, glass roof, collision and routing are untouched.

It mounts only in the city view (see [[office-3d-interiors#Locations & conditional rendering]]); entering the office unmounts it like the rest of the city.

## Hyperloop

[[src/renderer/src/screens/Office/office3d/objects/Hyperloop.tsx#HyperloopLine]] is an elevated translucent tube on portal pylons that straddle the north inner road (traffic passes underneath), a station cap and glass terminal with a skybridge, and one pod. Geometry constants (`HYPERLOOP_*`) live in `core/cityPlan.ts`.

The pod's timetable is the pure function [[src/renderer/src/screens/Office/office3d/hyperloopPod.ts#podPose]]: dwell at the station, depart east into the fog, then a fresh pod arrives from the west and brakes in. `CityBackdrop` keeps buildings out of the pylon corridor and terminal lot, so the line never clips scenery. The layer is city-only, so the pod schedule pauses indoors like [[office-3d-traffic]].
