# Recovered sampler contracts

`vest-layouts.json` records the ten reviewed material layouts: resource identity,
dimensions, mip offsets, addressing and colour-space metadata. It contains no
texture pixels, game meshes or exported shader bytecode. It reproduces the
sampler-count and compatibility cases that caused the browser failures.

`sampling-examples.glsl` is a small synthetic sampling expression used to test
rewriting nested coordinates, explicit mip levels and derivatives. The tests
exercise the production planner and shader rewriter against these fixtures.
