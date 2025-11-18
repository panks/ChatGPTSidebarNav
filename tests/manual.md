# Manual verification checklist

1. Load the unpacked extension from the `src` directory.
2. Open `https://chatgpt.com` and start or open an existing conversation.
3. Click the extension toolbar icon once:
   - A dark sidebar should slide in from the right.
   - All user bubbles should gain a blue highlight.
4. Post a new question:
   - The new bubble is highlighted automatically.
   - The sidebar list gains a new entry.
5. Click a sidebar item:
   - The page scrolls so the selected bubble is near the top of the viewport.
   - That bubble briefly flashes with a ripple animation.
6. Click **Collapse** inside the sidebar:
   - The panel slides out of view while remaining ready to expand.
7. Click the toolbar icon again:
   - The sidebar disappears and highlights are removed.

Record any deviations or console errors for follow-up.
