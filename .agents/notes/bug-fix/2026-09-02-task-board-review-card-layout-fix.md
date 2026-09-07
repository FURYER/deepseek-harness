# Multi-Agent Task Board review card layout and styling fix

Fix the visual clipping of action buttons in the Review column of the multi-agent task board by adding `flex-wrap: wrap` to `.cardActions`. Also, update the stylesheet to comply with DSH design standards for borders (0.5px), corner-shape, and scrollbar elevation rebinding.

Fixes an issue where buttons on the review task card were overflowing/clipping.
