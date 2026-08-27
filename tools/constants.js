"use strict";

// Parts this tool creates carry CHART_MARKER as their track name, so a rerun
// can find, remove and regenerate its own work without touching the user's
// instruments. The metaTags record how much the last run inserted.
module.exports = {
  CHART_MARKER: "Handbells Used Chart",
  META_MEASURES: "handbellChartMeasures",
  META_HID_STAVES: "handbellChartHidStaves",
  META_STYLE: "handbellChartStyle",
  // How many parts the last run appended, as against META_MEASURES, which is
  // how many measures it inserted. The two differ when every chart shares one
  // staff. Absent from anything written before that, and removeChart falls back
  // to counting the trailing generated parts when it is.
  META_PART_COUNT: "handbellChartPartCount",
  // What a chart part's <trackName> may be. The wording came in when chart
  // instruments gained names of their own; CHART_MARKER is what every run
  // before that wrote, and stays recognised so those charts are still found.
  CHART_TRACK_NAMES: [
    "Handbells Used Chart",
    "Handbells Used",
    "Handchimes Used",
    "SMBs Used",
  ],
};
