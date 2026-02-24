// Static HTML used by builder.js to render the Add Content dialog UI.
// Kept in a dedicated module so dialog markup is isolated from runtime logic.
export const REVEALCHART_BUILDER_DIALOG_HTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;">
    <h3 style="margin:0;">Insert Data Block</h3>
    <button type="button" data-action="help" title="Help" aria-label="Help">❔</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Block Type
      <select name="blockKind"><option value="chart">chart (:chart:)</option><option value="table">table (:table:)</option></select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Chart Type
      <select name="chartType"><option>line</option><option>bar</option><option>pie</option><option>doughnut</option><option>radar</option><option>polarArea</option></select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Mode
      <select name="mode"><option value="manual">Manual Data</option><option value="datasource">CSV Datasource</option></select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Width
      <input name="width" value="100%" placeholder="100%, 600px">
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Height
      <input name="height" value="400px" placeholder="400px, 60vh">
    </label>
  </div>
  <div style="margin-top:10px;padding:8px 10px;border:1px solid #3a2f1b;background:#251d10;color:#f0d9a6;border-radius:8px;font-size:12px;line-height:1.35;">
    RevealChart note: if charts appear blank on later slides, set front-matter <code>config.viewDistance</code> and <code>config.mobileViewDistance</code> higher than your total slide count.
    Always test your slide deck from the beginning after inserting a chart block to ensure data is loaded properly.
  </div>

  <fieldset data-section="manual" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;">
    <legend style="color:#9aa3b2;padding:0 6px;">Manual Data</legend>
    <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">Labels (comma-separated)
      <input name="labels" value="Jan, Feb, Mar">
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">Dataset Label
      <input name="datasetLabel" value="Dataset 1">
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Dataset Values (comma-separated)
      <input name="datasetValues" value="3, 7, 4">
    </label>
  </fieldset>

  <fieldset data-section="datasource" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;display:none;">
    <legend style="color:#9aa3b2;padding:0 6px;">CSV Datasource</legend>
    <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;color:#c4ccda;">File
      <input name="file" placeholder="attendance.csv">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Series
        <select name="series"><option value="column-series">column-series</option><option value="row-series">row-series</option></select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Label Column
        <input name="labelColumn" value="A" placeholder="A, C, 1">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Data Columns
        <input name="dataColumns" placeholder="B:D or E,F">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Data Rows
        <input name="dataRows" placeholder="2:10">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Header Row (column-series)
        <input name="headerRow" value="1">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Label Row (row-series)
        <input name="labelRow" value="1">
      </label>
    </div>
  </fieldset>

  <fieldset data-section="table" style="margin:12px 0 0;border:1px solid #303545;background:#111520;padding:10px;border-radius:8px;display:none;">
    <legend style="color:#9aa3b2;padding:0 6px;">Table Options</legend>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Class
        <input name="tableClass" value="lighttable" placeholder="lighttable, darktable">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">ID
        <input name="tableId" placeholder="attendance-table">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Data ID (auto-animate)
        <input name="tableDataId" placeholder="attendance-window">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Overflow
        <input name="tableOverflow" value="scroll" placeholder="scroll, auto, hidden">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Height
        <input name="tableHeight" placeholder="320px, 45vh">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Include Header
        <select name="includeHeader"><option value="true">true</option><option value="false">false</option></select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Default Align
        <select name="tableAlign"><option value="left">left</option><option value="center">center</option><option value="right">right</option></select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Default Format
        <select name="tableFormat"><option value="normal">normal</option><option value="currency">currency</option><option value="percentage">percentage</option></select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Currency
        <input name="tableCurrency" value="USD" placeholder="USD">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Align Columns
        <input name="tableAlignColumns" placeholder="C:right, D:right">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Format Columns
        <input name="tableFormatColumns" placeholder="C:currency, D:percentage">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Summarize Columns
        <input name="tableSummarizeColumns" placeholder="C:sum, D:average">
      </label>
    </div>
  </fieldset>

  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
    <button type="button" data-action="cancel">Cancel</button>
    <button type="button" data-action="insert" style="font-weight:600;">Insert</button>
  </div>
`;
