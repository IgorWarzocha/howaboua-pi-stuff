# @howaboua/pi-observatory

## 0.0.2

- - Existing Observatory indexes rebuild automatically once when the updated server starts. Source files are preserved.
  - Call details and conversation excerpts now read original session files rather than stored copies.
  - Missing or changed source records now appear as unavailable details while indexed statistics remain accessible.
  - Added --detail for read-only call inspection without starting the viewer or collectors.
  - Unchanged session scans no longer write to the index.
  - Notes history pruning no longer interrupts indexing. Retained content stays readable; pruned content appears as unavailable while historical statistics remain accessible.

## 0.0.1

- Added the initial standalone Observatory release with session usage and outcome views, custom collectors, a PCC cache tab and on-demand agent investigations. Opening the viewer updates it once, then pauses. Continuous monitoring is opt-in.
