# Avatar Asset Directory

Mini README:
- **Purpose:** Store binary glTF (`.glb`) models for avatar bodies and CRT TV heads.
- **Structure:**
  - `bodies/` – uploaded body models
  - `tvs/` – uploaded TV head models
  - `asset-manifest.json` – generated metadata describing available assets
- **Notes:** Default models (`default-body.glb`, `default-tv.glb`) may be placed
  directly in this directory if desired.

Drop appropriately named files into the respective subdirectories or upload
them via the admin panel. Metadata such as model scale and TV screen region are
stored in `asset-manifest.json`. If this file is missing when the server
starts, a new manifest is generated automatically by scanning the subfolders,
ensuring any manually copied `.glb` files appear in the admin interface.
