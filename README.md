# pale.vine

A tattoo layout generator for **[@pale.vine](https://www.instagram.com/pale.vine/)**.

Drop in a black & white image and it becomes a mask for a grid of dots —
brightness drives dot size, so a photo or sketch turns into a stippled
halftone field you can lay behind linework. Tune spacing, size, dispersion,
seed and threshold, frame it on an A4 artboard, and export a print-resolution
PNG ready for the stencil.

Runs as a PWA — install it to an iPad and work offline.

```
                                              .
                                          .  · .
                                      · . · .··  .
            \                      . ·.··:····· ·
             \\                  .·.··::·:·····::··
              \\\              ·.··::·:●·:·:::····· .
        _____  \\\__         .·:·:●·::●·::::::::···· ·
       /     \__    \___    ·:·●::●::::::::::::···· .
      /          \      \  ·::●::::::::::::::····· .
  ___/        ___ \_     \·::::::::::::::::····· ·
 /          _/   \  \__   \:::::::::::::····· .
/      ____/      \    \___/:::::::::····· .
\____ /            \       /::::····· ·
     \\\            \     /·····  .
      \\\\           \___/···  .
       \\\\\           /  ·· .
        \  \\\        /  .
         \   \\\____ /
          \   \    \\\
           \   \    \\\\
            \   \____ \\\\
                     \  \\
                      \  \\
                       \__\
```

## How it works

1. **Load a B&W image** — it becomes the mask.
2. A **grid of dots** is rendered from it:
   - dark areas get dots, light areas stay empty (adjustable threshold);
   - **brightness controls dot size** (darker → larger);
   - **dispersion** randomizes dot size and position; change the **seed** for a new layout.
3. **Export PNG** at print resolution (set the long-side pixels).

## Two modes

- **Canvas** — preview the result. Two fingers: zoom / rotate / pan (view only).
  Three fingers (or right-drag on desktop): pan the dot grid. Wheel zooms the view.
- **Mask** — position and scale the mask inside the A4 artboard, then switch back.

## Install on iPad

Open in Safari → Share → *Add to Home Screen*. Launches like an app, works offline.

## Stack

Vanilla JS + Canvas, no dependencies. Hosted on GitHub Pages.
