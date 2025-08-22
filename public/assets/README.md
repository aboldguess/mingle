# Avatar Asset Directory

This folder holds the binary glTF (`.glb`) models that power avatar bodies and
CRT TV heads. Models are **not** tracked in version control—upload your own
files at runtime instead.

- `default-body.glb`: optional body model loaded for all avatars.
- `default-tv.glb`: optional TV model. For custom TVs include a child mesh named
  `screen` to receive the webcam texture.

Drop appropriately named files into this directory or upload them via the admin
panel to change the default appearance.
