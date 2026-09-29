// REVELation window placement — KWin script template
//
// lib/kwinWindowHelper.js fills in PARAMS, writes this to a temp file and loads it
// into KWin over D-Bus. The script finds the window whose title starts with the
// token, moves it to the monitor matching PARAMS.bounds, then unloads itself.
// The app treats "script unloaded" as success. Supports Plasma 5 and Plasma 6.

var PARAMS = __PARAMS__;

var plasma6 = typeof workspace.windowList === 'function';
var done = false;

function listWindows() {
    return plasma6 ? workspace.windowList() : workspace.clientList();
}

function geometryMatches(g, r) {
    return g.x === r.x && g.y === r.y && g.width === r.width && g.height === r.height;
}

function containsCenter(g, r) {
    var cx = r.x + r.width / 2;
    var cy = r.y + r.height / 2;
    return cx >= g.x && cx < g.x + g.width && cy >= g.y && cy < g.y + g.height;
}

// Plasma 6 addresses monitors as Output objects, Plasma 5 by index.
function findOutput(r) {
    var candidates = [];
    if (plasma6) {
        var screens = workspace.screens;
        for (var i = 0; i < screens.length; i++)
            candidates.push({ output: screens[i], geometry: screens[i].geometry });
    } else {
        for (var j = 0; j < workspace.numScreens; j++)
            candidates.push({ output: j, geometry: workspace.clientArea(KWin.ScreenArea, j, workspace.currentDesktop) });
    }
    for (var k = 0; k < candidates.length; k++)
        if (geometryMatches(candidates[k].geometry, r)) return candidates[k].output;
    for (var m = 0; m < candidates.length; m++)
        if (containsCenter(candidates[m].geometry, r)) return candidates[m].output;
    return null;
}

function place(w) {
    var r = PARAMS.bounds;
    var output = findOutput(r);
    if (output === null) {
        print('REVELation: no monitor matches ' + JSON.stringify(r));
        return false;
    }
    w.fullScreen = false;
    if (!PARAMS.fullscreen && typeof w.setMaximize === 'function')
        w.setMaximize(false, false);
    workspace.sendClientToScreen(w, output);
    if (PARAMS.fullscreen) {
        w.fullScreen = true;
    } else {
        var rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        if (plasma6) w.frameGeometry = rect;
        else w.geometry = rect;
    }
    return true;
}

function unloadSelf() {
    callDBus('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', PARAMS.pluginName);
}

function tryWindow(w) {
    if (done || !w || typeof w.caption !== 'string' || w.caption.indexOf(PARAMS.token) !== 0)
        return;
    done = true;
    if (place(w))
        unloadSelf();
}

// The title may not be set yet, or the window may not be mapped yet, so also
// watch caption changes and new windows until the app unloads us.
function watch(w) {
    if (w && w.captionChanged)
        w.captionChanged.connect(function () { tryWindow(w); });
}

var existing = listWindows();
for (var n = 0; n < existing.length && !done; n++)
    tryWindow(existing[n]);

if (!done) {
    for (var p = 0; p < existing.length; p++)
        watch(existing[p]);
    var added = plasma6 ? workspace.windowAdded : workspace.clientAdded;
    added.connect(function (w) {
        tryWindow(w);
        watch(w);
    });
}
