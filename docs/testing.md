# Running tests

Use `npm test`. The runner discovers `test/*.test.mjs`, excludes fixture/helper files and launches isolated Node test processes in parallel. On this 12-thread PC it uses **11 workers**, leaving one logical CPU available. It prints the selected concurrency and elapsed time.

```powershell
npm test
npm test -- --jobs 4
npm test -- --jobs 4 test/manticore-quill.test.mjs test/manticore-quill-flight.test.mjs
npm run test:serial
```

`TEST_JOBS` also sets the worker count; `--jobs` overrides it. Default discovery schedules larger files first to reduce the long tail; explicitly supplied files retain their order. Cases within a file remain sequential because fixtures replace Foundry globals such as `game`, `canvas` and `CONFIG`. Turning on case-level concurrency inside those files would introduce state races. Expensive Eagle groups are split into separate files while preserving all existing assertions. Flight integration groups use real persistent Web Workers, matching the normal production backend; explicit worker-failure/native-fallback tests remain.

`node --test` previously already parallelized files. The improvements are explicit configurable concurrency, splitting long flight groups, excluding helper-only pseudo tests, and using production worker planning in flight integration. This is why new-runner totals can be smaller than historical default-discovery totals even when no assertion was removed. Full runs and targeted runs report failures through their exit status.

On this PC, the pre-change run passed 841 entries in 26.2 seconds. The 0.31.0 parallel run, including the new quill and cross-level coverage, passed 868 entries in 16.6 seconds with 11 workers. Timings vary with load. No existing assertion was removed; helper-only discovery entries are excluded.
