# Office 3D Convention Center & Hyperloop

The Office tab's city view is Los Angeles: the office wears a scaled Los Angeles Convention Center, and a hyperloop line runs above the north road.

## Convention center exterior

[[src/renderer/src/screens/Office/office3d/objects/ConventionCenter.tsx#ConventionCenterExterior]] is the city-view massing. Interior walls, the glass roof, collision and routing stay the office's.

The roof plan in [[src/renderer/src/screens/Office/office3d/laccPlan.ts#LACC_PLAN]] follows overhead photos of the real complex at 1201 S Figueroa. South Hall is the solid pointed leaf with a radial seam grid. West Hall is the flat rectangle joined to that leaf's northwest edge. The green-glass drum stands in the joint. The south door keeps the white space-frame canopy, the gridded facade, and the convention-center name. Palms on the forecourt stand off the sidewalk.

It mounts only in the city view (see [[office-3d-interiors#Locations & conditional rendering]]); entering the office unmounts it like the rest of the city. The plan's footprint tests live in [[src/renderer/src/screens/Office/office3d/laccPlan.test.ts]].

## Hyperloop

[[src/renderer/src/screens/Office/office3d/objects/Hyperloop.tsx#HyperloopLine]] is an elevated translucent tube on portal pylons that straddle the north inner road (traffic passes underneath), a station cap and glass terminal with a skybridge, and one pod. Geometry constants (`HYPERLOOP_*`) live in `core/cityPlan.ts`.

The pod's timetable is the pure function [[src/renderer/src/screens/Office/office3d/hyperloopPod.ts#podPose]]: dwell at the station, depart east into the fog, then a fresh pod arrives from the west and brakes in. `CityBackdrop` keeps buildings out of the pylon corridor and terminal lot, so the line never clips scenery. The layer is city-only, so the pod schedule pauses indoors like [[office-3d-traffic]].
