"use strict";

// Parts this tool creates carry CHART_MARKER as their track name, so a rerun
// can find, remove and regenerate its own work without touching the user's
// instruments. The metaTags record how much the last run inserted.
module.exports = {
  CHART_MARKER: "Handbells Used Chart",
  META_MEASURES: "handbellChartMeasures",
  META_FRAMES: "handbellChartFrames",
};
