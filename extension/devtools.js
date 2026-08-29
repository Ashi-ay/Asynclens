// Create the AsyncLens panel in Chrome DevTools
chrome.devtools.panels.create(
    "AsyncLens",
    "", // You can add an icon path here later
    "panel.html",
    function(panel) {
        console.log("AsyncLens panel created.");
    }
);
