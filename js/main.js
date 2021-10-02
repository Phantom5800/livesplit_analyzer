const INCLUDE_IN_TIMESAVE_COL = 0;
const SECTION_COL = 1;
const SPLIT_NAME_COL = 2;
const PB_SPLIT_TIME_COL = 3;
const PB_SEGMENT_TIME_COL = 4;
const AVG_SEGMENT_TIME_COL = 5;
const BEST_SEGMENT_TIME_COL = 6;
const BEST_SEGMENT_DATE_COL = 7;
const RUNS_ENDED_COL = 8;
const RUNS_ENDED_BEFORE_COL = 9;
const COL_CNT = 10;

var SmallGapMs = 5000;
var MediumGapMs = 10000;
var LargeGapMs = 20000;
var MillisecondAccuracy = 0;
var PercentageAccuracy = 0;
var TimingMode = "RealTime";
var RemoveOutliers = false;
const SplitOutlierThreshold = 2; // exclude times greater than avg * this value when RemoveOutliers is enabled
var AllSplitsSelected = false;

function analyzeSplits(event) {
    console.log("file dropped");

    if (event.dataTransfer.items) {
        for (var i = 0; i < event.dataTransfer.items.length; ++i) {
            if (event.dataTransfer.items[i].kind === 'file') {
                var file = event.dataTransfer.items[i].getAsFile();
                parseFile(file);
            }
        }
    }

    event.preventDefault();
}

function onGapValueUpdate(gapId, value) {
    if (gapId === 0) {
        SmallGapMs = parseInt(value);
        localStorage.setItem("small_gap_time", SmallGapMs);
    } else if (gapId === 1) {
        MediumGapMs = parseInt(value);
        localStorage.setItem("medium_gap_time", MediumGapMs);
    } else if (gapId === 2) {
        LargeGapMs = parseInt(value);
        localStorage.setItem("large_gap_time", LargeGapMs);
    }
}

function onMsAccuracyChange(value) {
    MillisecondAccuracy = value;
    localStorage.setItem("msAccuracy", value);
}

function onPercentAccuracyChange(value) {
    PercentageAccuracy = value;
    localStorage.setItem("percentAccuracy", value);
}

function onTimingModeChange(value) {
    TimingMode = value;
    localStorage.setItem("timing_mode", value);
}

function onRemoveOutliersChange(value) {
    RemoveOutliers = value;
    localStorage.setItem("remove_outliers", (value) ? "true" : "false");
}

function selectAllToggle(value) {
    AllSplitsSelected = value;
    localStorage.setItem("allSplitsSelected", AllSplitsSelected);

    $("input[id^='include-']").prop("checked", value);
    $("#include-0").change();
}

function updateTimesave(segmentCount) {
    var totalTimesave = 0;
    var selectedTimesave = 0;
    var selectedCount = 0;

    for (var i = 0; i < segmentCount; ++i) {
        var pb_time_str = $("#pb-segment-" + i).html();
        if (pb_time_str[0] === '\u2606') {
            pb_time_str = pb_time_str.substr(2, pb_time_str.length - 4);
        }
        var pb_time = convertSegmentStrToMs(pb_time_str);
        var best_time = convertSegmentStrToMs($("#best-segment-" + i).html());
        var includeThisTime = document.getElementById("include-" + i).checked;
        if (includeThisTime) {
            ++selectedCount;
            selectedTimesave += (pb_time - best_time);
        }
        totalTimesave += (pb_time - best_time);
    }

    if (selectedCount === 0 || selectedCount === segmentCount) {
        $("#timesave").html(convertMsToTimeString(totalTimesave) + " (Across all splits)");
    } else {
        $("#timesave").html(convertMsToTimeString(selectedTimesave) 
            + " (Across " 
            + selectedCount 
            + " split" 
            + ((selectedCount > 1) ? "s" : "")
            + ")"
        );
    }
}

function toggleColumn(columnId, checkbox) {
    if (checkbox.checked) {
        $(".col-" + columnId).show();
        localStorage.setItem("col-visibility-" + columnId, "true");
    } else {
        $(".col-" + columnId).hide();
        localStorage.setItem("col-visibility-" + columnId, "false");
    }
}

// method for forcing existing column visibility after parsing is complete
function correctColumnVisibilities() {
    for (var i = 0; i < COL_CNT; ++i) {
        if (localStorage.getItem("col-visibility-" + i) !== "true") {
            $(".col-" + i).hide();
        }
    }
}

var attemptDataTable = [];
var segmentLifetimes = [[]];

function parseFile(file) {
    // clear out any previous data
    attemptDataTable = [];
    segmentLifetimes = [[]];
    $(".split").empty(); // delete all old split sections

    // read xml file
    var fileReader = new FileReader();
    fileReader.onload = function() {
        var parser = new DOMParser();
        xmlDoc = parser.parseFromString(fileReader.result, "text/xml");

        // game title
        $("#game").html(xmlDoc.getElementsByTagName("GameName"));

        // build category
        var categoryName = xmlDoc.getElementsByTagName("CategoryName")[0].textContent;
        var platform = xmlDoc.getElementsByTagName("Platform")[0].textContent;
        var region = xmlDoc.getElementsByTagName("Region")[0].textContent;
        var variables = xmlDoc.getElementsByTagName("Variables")[0];
        if (platform || region || variables) {
            categoryName += " (";

            // add all variables
            var variableCnt = 0;
            if (variables && variables.childElementCount) {
                variableCnt = variables.childElementCount;
                for (var i = 0; i < variableCnt; ++i) {
                    categoryName += variables.children[i].textContent;
                    if (i != variableCnt - 1) {
                        categoryName += ', ';
                    }
                }
            }

            var hasPlatform = platform && platform.trim().length > 0;
            var hasRegion = region && region.trim().length > 0;

            if (variableCnt > 0 && (hasPlatform || hasRegion)) {
                categoryName += ", ";
            }

            // display platform
            if (hasPlatform) {
                categoryName += platform;
                if (region) {
                    categoryName += ", ";
                }
            }

            // display region if specified
            if (hasRegion) {
                categoryName += region;
            }
            categoryName += ")";
        }
        $("#category").html(categoryName);

        // fill out interesting data
        countAttempts(xmlDoc.getElementsByTagName("AttemptHistory")[0]);

        // parse splits
        parseSegments(xmlDoc.getElementsByTagName("Segment"));
    }
    fileReader.readAsText(file);
}

function convertStrToDate(dateStr) {
    var rx = /((.*)\/(.*)\/(.*)) ((.*):(.*):(.*))/g
    var results = rx.exec(dateStr);

    var year = results[4];
    var month = parseInt(results[2]) - 1; // 0 based month index
    var day = results[3];

    var hours = results[6];
    var minutes = results[7];
    var seconds = results[8];

    var dateValue = new Date();
    dateValue.setUTCFullYear(year, month, day);
    dateValue.setUTCHours(hours);
    dateValue.setUTCMinutes(minutes);
    dateValue.setUTCSeconds(seconds);

    return dateValue;
}

function convertSegmentStrToMs(str) {
    var rx = /((.*):(.*):(.*)\.(.{0,3}))/g
    var results = rx.exec(str);

    if (results && results.length >= 6) {
        var hours = parseInt(results[2]);
        var minutes = parseInt(results[3]);
        var seconds = parseInt(results[4]);
        var ms = parseInt(results[5]);
        return ms + seconds * 1000 + minutes * 60 * 1000 + hours * 60 * 60 * 1000;
    } else {
        // try without ms just in case time was exact
        rx = /((.*):(.*):(.*))/g;
        results = rx.exec(str);

        if (results && results.length >= 5) {
            var hours = parseInt(results[2]);
            var minutes = parseInt(results[3]);
            var seconds = parseInt(results[4]);
            return seconds * 1000 + minutes * 60 * 1000 + hours * 60 * 60 * 1000;
        }
    }
    return 0;
}

function convertMsToTimeString(ms) {
    if (ms === Infinity)
        return "undefined";

    var total_seconds = Math.trunc(ms / 1000);
    var total_minutes = Math.trunc(total_seconds / 60);
    var total_hours = Math.trunc(total_minutes / 60);
    var total_days = Math.trunc(total_hours / 24);
    total_hours = total_hours - total_days * 24;
    total_minutes = total_minutes - total_hours * 60 - total_days * 24 * 60;
    total_seconds = total_seconds - total_hours * 3600 - total_minutes * 60 - total_days * 24 * 3600;
    
    var total_ms = "";
    if (MillisecondAccuracy > 0) {
        milliseconds = ms - total_seconds * 1000 - total_minutes * 60 * 1000 - total_hours * 60 * 60 * 1000 - total_days * 24 * 60 * 60 * 1000;
        milliseconds = Math.round(milliseconds / Math.pow(10, 3 - MillisecondAccuracy));
        total_ms = ".";
        if (milliseconds < 100 && MillisecondAccuracy > 2) {
            total_ms += "0";
        }
        if (milliseconds < 10 && MillisecondAccuracy > 1) {
            total_ms += "0";
        }
        total_ms += milliseconds;
    }
    return (
        ((total_days > 0) ? total_days + "d " : "")
        + total_hours + ":" 
        + (total_minutes).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}) + ":" 
        + (total_seconds).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}) 
        + total_ms
    );
}

function countAttempts(attemptHistory) {
    var completedRuns = 0;
    //$("#attempts").html(xmlDoc.getElementsByTagName("AttemptCount")[0].textContent);
    $("#attempts").html(attemptHistory.childElementCount.toLocaleString());
    for (var i = 0; i < attemptHistory.childElementCount; ++i) {
        var attemptData = {};
        var attempt = attemptHistory.children[i];
        if (attempt.children && attempt.children.length > 0) {
            var attemptTimeContainer = attempt.getElementsByTagName(TimingMode);
            if (attemptTimeContainer && attemptTimeContainer.length > 0) {
                attemptData.finishTime = convertSegmentStrToMs(attemptTimeContainer[0].textContent);
            }
            ++completedRuns;
        }

        try {
            if (attempt.attributes['started'] && attempt.attributes['ended']) {
                attemptData.startTime = convertStrToDate(attempt.attributes['started'].nodeValue);
                attemptData.endTime = convertStrToDate(attempt.attributes['ended'].nodeValue);
                attemptData.duration = attemptData.endTime - attemptData.startTime; // elapsed time in ms
            }
        } catch(error) {
            console.log(error);
        }
        attemptDataTable.push(attemptData);
    }
    var attemptCount = parseInt($("#attempts").html().replace(/,/g, ""));
    var completedPercent = Math.trunc(completedRuns / attemptCount * 100 * Math.pow(10, PercentageAccuracy)) / Math.pow(10, PercentageAccuracy);
    $("#completed").html(completedRuns.toLocaleString() + " (" + completedPercent + "%)");

    // calculate total play time
    var totalPlayTime = 0;
    for (var i = 0; i < attemptDataTable.length; ++i) {
        if (attemptDataTable[i].duration) {
            totalPlayTime += attemptDataTable[i].duration;
        }
    }
    $("#total_time").html(convertMsToTimeString(totalPlayTime));
}

function findDayOfAttempt(attemptTime) {
    for (var i = 0; i < attemptDataTable.length; ++i) {
        var attempt = attemptDataTable[i];
        var time = convertSegmentStrToMs(attemptTime);
        if (time === attempt.finishTime) {
            return attempt.endTime.toLocaleString("en-US", {"dateStyle": "short"});
        }
    }
    return undefined;
}

// Parse the splits data out into meaningful information
function parseSegments(segmentList) {
    // parse the xml into meaningful data
    var table = $("#splits_table");
    var startOfSection = null;

    var totalBestTime = 0;
    var totalAvgTime = 0;
    var currentPBTime = 0;
    var currentPBSplitTime = 0;
    var attemptCnt = parseInt($("#attempts").html().replace(/,/g, ""));
    segmentLifetimes.length = attemptCnt;
    for (var i = 0; i < segmentLifetimes.length; ++i) {
        segmentLifetimes[i] = 0;
    }

    // iterate over all splits
    for (var i = 0; i < segmentList.length; ++i) {
        var row = document.createElement("tr");
        row.className = "split";
        var segment = segmentList[i]; // current split

        var bestTimeContainer = segment.getElementsByTagName("BestSegmentTime")[0].getElementsByTagName(TimingMode);
        var bestTime = (bestTimeContainer && bestTimeContainer.length > 0) ? bestTimeContainer[0].textContent.trim() : "00:00:00.000";
        var segmentHistory = segment.getElementsByTagName("SegmentHistory")[0]; // all times for this split

        totalBestTime += convertSegmentStrToMs(bestTime);

        // calculate information from segment history
        var bestTimeDate = undefined;
        var currentAvg = 0;
        var avgCnt = 0;
        var ignoredIds = []; // track the attempts that were skipped when averaging times
        // iterate over all attempts of current split
        for (var k = 0; k < segmentHistory.childElementCount; ++k) {
            var timeNode = segmentHistory.children[k]; // time information about segment attempt
            var timeNodeId = parseInt(timeNode.attributes["id"].nodeValue) - 1; // attemptId for this segment time
            
            if (timeNode.children && timeNode.children.length > 0) {
                // update latest segment a run has been seen at
                var hasPreviousSegment = segmentLifetimes[timeNodeId] === i; // check if the current attempt skipped the previous split
                segmentLifetimes[timeNodeId] = i + 1; // treat 0 as having not finished a split, so offset by 1 for each completed split

                var segmentTimeContainer = timeNode.getElementsByTagName(TimingMode); // get GameTime vs RealTime
                var segmentTime = (segmentTimeContainer && segmentTimeContainer.length > 0) ? segmentTimeContainer[0].textContent.trim() : "00:00:00.000";
                if (hasPreviousSegment) { // only include a time if the previous segment was not skipped
                    currentAvg += convertSegmentStrToMs(segmentTime);
                    ++avgCnt;
                } else {
                    ignoredIds.push(k);
                }

                // found date best time was recorded
                if (segmentTime === bestTime) {
                    var attemptId = parseInt(timeNode.attributes["id"].nodeValue) - 1;
                    if (attemptId >= 0) {
                        bestTimeDate = attemptDataTable[attemptId].endTime.toLocaleString("en-US", {"dateStyle": "short"});
                    } else {
                        bestTimeDate = "Manual or Deleted";
                    }
                }
            }
        }
        currentAvg /= avgCnt;
        // remove any times from average that are more than double the previous calculated average
        if (RemoveOutliers) {
            var oldAvg = currentAvg;
            currentAvg = 0;
            avgCnt = 0;
            for (var k = 0; k < segmentHistory.childElementCount; ++k) {
                var timeNode = segmentHistory.children[k];
                var timeNodeId = parseInt(timeNode.attributes["id"].nodeValue) - 1;
    
                if (timeNode.children && timeNode.children.length > 0) {
                    var segmentTimeContainer = timeNode.getElementsByTagName(TimingMode);
                    var segmentTime = (segmentTimeContainer && segmentTimeContainer.length > 0) ? segmentTimeContainer[0].textContent.trim() : "00:00:00.000";
                    var time = convertSegmentStrToMs(segmentTime);
                    if (time < oldAvg * SplitOutlierThreshold && !ignoredIds.includes(k)) {
                        currentAvg += time;
                        ++avgCnt;
                    }
                }
            }
            currentAvg /= avgCnt;
        }
        if (!isNaN(currentAvg)) {
            totalAvgTime += currentAvg;
        }

        // determine each column's values
        for (var j = 0; j < COL_CNT; ++j) {
            var col = document.createElement("td");
            col.className = "col-" + j;

            if (j === INCLUDE_IN_TIMESAVE_COL) {
                var checkbox = document.createElement("input");
                checkbox.id = "include-" + i;
                checkbox.type = "checkbox";
                checkbox.checked = AllSplitsSelected;
                checkbox.onchange = function() {
                    updateTimesave(segmentList.length);
                }
                col.appendChild(checkbox);
                col.style.width = "2em";
            } else if (j === SECTION_COL) { // section name
                if (startOfSection === null) {
                    startOfSection = col;
                }
            } else if (j === SPLIT_NAME_COL) { // split name
                var splitName = segment.children[0].textContent;
                if (splitName[0] === '-') {
                    splitName = splitName.substr(1, splitName.length).trim();
                } else {
                    if (splitName[0] === '{') {
                        // extract section name from braces
                        var rx = /(?<=\{)(.*?)(?=\})/g;
                        var section = rx.exec(splitName)[0];
                        splitName = splitName.substr(section.length + 2).trim();
                        if (startOfSection !== null) {
                            startOfSection.innerHTML = section;
                        }
                    } else {
                        // section name is just the name of this split
                        if (startOfSection !== null) {
                            startOfSection.innerHTML = splitName;
                        }
                    }
                    startOfSection = null;
                }
                col.innerHTML = splitName;
            } else if (j === PB_SPLIT_TIME_COL) { // pb split time
                var splitTimes = segment.getElementsByTagName("SplitTimes")[0];
                for (var k = 0; k < splitTimes.childElementCount; ++k) {
                    if (splitTimes.children[k].attributes["name"].nodeValue === "Personal Best") {
                        if (splitTimes.children[k].childElementCount > 0) {
                            var fullTimeContainer = splitTimes.children[k].getElementsByTagName(TimingMode);
                            var fullTime = (fullTimeContainer && fullTimeContainer.length > 0) ? fullTimeContainer[0].textContent : "00:00:00.000";
                            currentPBTime = currentPBSplitTime;
                            currentPBSplitTime = convertSegmentStrToMs(fullTime);
                            col.innerHTML = convertMsToTimeString(convertSegmentStrToMs(fullTime));
    
                            // final split time
                            if (i === segmentList.length - 1) {
                                $("#pb_time").html(col.innerHTML);
                                // find pb date
                                var dayOfPB = findDayOfAttempt(fullTime);
                                $("#pb_date").html(dayOfPB);
    
                                // convert from ms->days
                                var daysSincePB = Math.trunc(parseInt(new Date() - new Date(dayOfPB)) / 1000 / 60 / 60 / 24);
                                $("#pb_offset").html(daysSincePB.toLocaleString());
                            }
                        }
                    }
                }
            } else if (j === PB_SEGMENT_TIME_COL) { // pb segment time
                col.id = "pb-segment-" + i;
                var currentPBSegmentTime = currentPBSplitTime - currentPBTime;
                if (currentPBSegmentTime > 0) {
                    var bestMs = convertSegmentStrToMs(bestTime);

                    col.innerHTML = convertMsToTimeString(currentPBSegmentTime);

                    // set style based on difference from best
                    if (currentPBSegmentTime > bestMs + LargeGapMs) {
                        col.className += " large_gap";
                    } else if (currentPBSegmentTime > bestMs + MediumGapMs) {
                        col.className += " medium_gap";
                    } else if (currentPBSegmentTime > bestMs + SmallGapMs) {
                        col.className += " small_gap";
                    } else if (currentPBSegmentTime === bestMs) {
                        col.innerHTML = "\u2606 " + col.innerHTML + " \u2606";
                    }
                }
            } else if (j === AVG_SEGMENT_TIME_COL) { // average segment time
                col.innerHTML = convertMsToTimeString(currentAvg);
                var bestMs = convertSegmentStrToMs(bestTime);

                // set style based on difference from best
                if (currentAvg > bestMs + LargeGapMs) {
                    col.className += " large_gap";
                } else if (currentAvg > bestMs + MediumGapMs) {
                    col.className += " medium_gap";
                } else if (currentAvg > bestMs + SmallGapMs) {
                    col.className += " small_gap";
                } 
            } else if (j === BEST_SEGMENT_TIME_COL) { // best segment time
                col.id = "best-segment-" + i;
                col.innerHTML = convertMsToTimeString(convertSegmentStrToMs(bestTime));
            } else if (j === BEST_SEGMENT_DATE_COL) { // best segment time date
                col.innerHTML = bestTimeDate;
            } else if (j === RUNS_ENDED_COL) { // resets during this split
                col.id = "resets-" + i;
            } else if (j === RUNS_ENDED_BEFORE_COL) { // resets before or during this split
                col.id = "resets-before-" + i;
            }
            row.appendChild(col);
        }

        table.append(row);
    }

    // fill out final totals
    $("#best_time").html(convertMsToTimeString(totalBestTime));
    $("#average_time").html(convertMsToTimeString(totalAvgTime));

    // find last finished run
    for (var i = attemptDataTable.length - 1; i >= 0; --i) {
        if (attemptDataTable[i].finishTime) {
            $("#last_finished_time").html(convertMsToTimeString(attemptDataTable[i].finishTime));
            // effectively get only the day from end time
            var msSinceLastRun = parseInt(new Date() - new Date(attemptDataTable[i].endTime.toLocaleString("en-US", {"dateStyle": "short"})));
            $("#finished_run_days").html(Math.trunc(msSinceLastRun / 1000 / 60 / 60 / 24).toLocaleString());
            break;
        }
    }

    var runsDeadAtSegment = [];
    runsDeadAtSegment.length = segmentList.length;
    for (var i = 0; i < segmentLifetimes.length; ++i) {
        if (!runsDeadAtSegment[segmentLifetimes[i]]) {
            runsDeadAtSegment[segmentLifetimes[i]] = 1;
        } else {
            ++runsDeadAtSegment[segmentLifetimes[i]];
        }
    }

    var totalDeaths = 0;
    for (var i = 0; i < runsDeadAtSegment.length; ++i) {
        var count = runsDeadAtSegment[i];
        if (count > 0) {
            var percentage = Math.round(count / attemptCnt * 100 * Math.pow(10, PercentageAccuracy)) / Math.pow(10, PercentageAccuracy)
            $("#resets-" + i).html(count.toLocaleString() + " (" + percentage + "%)");
            
            totalDeaths += count;
            var totalPercentage = Math.round(totalDeaths / attemptCnt * 100 * Math.pow(10, PercentageAccuracy)) / Math.pow(10, PercentageAccuracy);
            $("#resets-before-" + i).html(totalDeaths.toLocaleString() + " (" + totalPercentage + "%)");
        }
    }

    correctColumnVisibilities();
    updateTimesave(segmentList.length);
}

function preventDefaultDrag(event) {
    event.preventDefault();
}

function handleExport() {
    var export_type = $("#export_settings option:selected").text();
    var generated_file = ""
    var file_type = "";

    if (export_type === "csv") {
        generated_file = exportCsv(false);
        file_type = "text/csv";
    }

    // generate blob for new file
    var fileData = new Blob([generated_file], { type: file_type });
    var fileOut = window.URL.createObjectURL(fileData);
    
    // prompt file download
    var fileLink = document.createElement("a");
    fileLink.download = $("#game").text() + "-" + $("#category").text() + "." + export_type;
    fileLink.href = fileOut;
    fileLink.click();

    // revoke blob url
    window.URL.revokeObjectURL(fileOut);
}

var urlParams = {};

function getUrlParamCount() {
    return Object.keys(urlParams).length;
}

function getUrlVars() {
    if (getUrlParamCount() === 0) {
        var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
        urlParams[key.toLowerCase()] = value;
        });
    }
    return urlParams;
}

function getUrlParam(parameter, defaultValue) {
    var urlParameter = defaultValue;
    if (parameter in urlParams) {
        urlParameter = urlParams[parameter];
    }
    return urlParameter;
}

function getBaseUri() {
    var baseUri = "";
    if (location.hostname === "") { // local file
        baseUri = window.location.protocol + "/" + window.location.host + "/" + window.location.pathname.split('.')[0] + ".html";
    } else { // hosted site
        baseUri = window.location.protocol + "//" + window.location.host + "/" + window.location.pathname.split('/')[1];
    }
    return baseUri;
}

function handleUriGen() {
    var pageContent = exportCsv(true);
    pageContent = LZString.compressToEncodedURIComponent(pageContent);

    var uri = getBaseUri();
    uri += "?game=" + encodeURIComponent($("#game").text());
    uri += "&cat=" + encodeURIComponent($("#category").text());
    uri += "&data=" + pageContent;
    uri += "&summary=" + LZString.compressToEncodedURIComponent(exportSummaryTable());
    navigator.clipboard.writeText(uri);
}

function exportSummaryTable() {
    var summary = $("#pb_date").text() + ","
        + $("#pb_offset").text() + ","
        + $("#average_time").text() + ","
        + $("#best_time").text() + ","
        + $("#last_finished_time").text() + ","
        + $("#finished_run_days").text() + ","
        + $("#total_time").text() + ","
        + $("#completed").text() + ","
        + $("#attempts").text() +",";

    return summary;
}

function importSummaryTable(data) {
    var segments = data.split(',');
    $("#pb_date").html(segments[0]);
    $("#pb_offset").html(segments[1]);
    $("#average_time").html(segments[2]);
    $("#best_time").html(segments[3]);
    $("#last_finished_time").html(segments[4]);
    $("#finished_run_days").html(segments[5]);
    $("#total_time").html(segments[6]);
    $("#completed").html(segments[7]);
    $("#attempts").html(segments[8]);
}

function exportCsv(encode_comma) {
    var out = "";

    var rowCount = $(".col-1").length;
    for (var i = 0; i < rowCount; ++i) {
        for (var j = 0; j < COL_CNT; ++j) {
            var cell = $(".col-" + (j + 1))[i];
            if (cell) {
                var text = cell.innerText;
                if (encode_comma) {
                    text = text.replace(/,/g, '`');
                }
                out += text;
                if (j < COL_CNT - 2) {
                    out += ",";
                }
            }
        }
        out += "\n";
    }

    return out;
}

function importCsvFromUri(csv) {
    var lines = csv.split('\n');

    var dataTable = document.getElementById("splits_table");
    for (var i = 1; i < lines.length - 1; ++i) {
        var parts = lines[i].split(',');
        var row = document.createElement("tr");

        // add checkbox first
        var checkbox_col = document.createElement("td");
        var checkbox = document.createElement("input");
        checkbox.id = "include-" + (i - 1);
        checkbox.type = "checkbox";
        checkbox.checked = AllSplitsSelected;
        checkbox.onchange = function() {
            updateTimesave(lines.length - 2);
        }
        checkbox_col.appendChild(checkbox);
        checkbox_col.style.width = "2em";
        row.appendChild(checkbox_col);
        dataTable.appendChild(row);

        // add each column from csv
        for (var j = 0; j < parts.length; ++j) {
            var col = document.createElement("td");
            col.className = "col-" + (j + 1);
            col.innerHTML = parts[j].replace(/`/g, ',');

            if (j + 1 === PB_SEGMENT_TIME_COL) {
                col.id = "pb-segment-" + (i - 1);
            } else if (j + 1 === AVG_SEGMENT_TIME_COL) {
                col.id = "avg-segment-" + (i - 1);
            } else if (j + 1 === BEST_SEGMENT_TIME_COL) {
                col.id = "best-segment-" + (i - 1);

                var bestTime = convertSegmentStrToMs(parts[j]);
                var pbTime = convertSegmentStrToMs($("#pb-segment-" + (i - 1)).text());
                var avgTime = convertSegmentStrToMs($("#avg-segment-" + (i - 1)).text());

                function setColors(time, bestTime, elem) {
                    if (time - bestTime > LargeGapMs) {
                        elem.className += " large_gap";
                    } else if (time - bestTime > MediumGapMs) {
                        elem.className += " medium_gap";
                    } else if (time - bestTime > SmallGapMs) {
                        elem.className += " small_gap";
                    }
                }

                setColors(pbTime, bestTime, document.getElementById("pb-segment-" + (i - 1)));
                setColors(avgTime, bestTime, document.getElementById("avg-segment-" + (i - 1)));
            }

            row.appendChild(col);
        }
    }

    $("#pb_time").html($(".col-" + PB_SPLIT_TIME_COL + ":last").html());
}

// load local storage settings on page load if they exist
$(document).ready(function() {
    // check for uri information
    getUrlVars();
    var game = getUrlParam("game", "Game Title");
    $("#game").html(decodeURIComponent(game));
    var category = getUrlParam("cat", "Category");
    $("#category").html(decodeURIComponent(category));
    var dataset = getUrlParam("data", "");
    if (dataset.length > 0) {
        var decompressed = LZString.decompressFromEncodedURIComponent(dataset);
        importCsvFromUri(decompressed);
    }
    var summary = getUrlParam("summary", "");
    if (summary.length > 0) {
        var decompressed = LZString.decompressFromEncodedURIComponent(summary);
        importSummaryTable(decompressed);
    }

    // read all local storage based settings
    function localStorageGetWithDefault(key, defaultValue) {
        const value = localStorage.getItem(key);
        if (!value) {
            localStorage.setItem(key, defaultValue);
            return defaultValue;
        }
        return value;
    }

    $("#timing_mode").val(localStorageGetWithDefault("timing_mode", TimingMode)).change();
    $("#msAccuracy").prop("selectedIndex", parseInt(localStorageGetWithDefault("msAccuracy", MillisecondAccuracy))).change();
    $("#percentAccuracy").prop("selectedIndex", parseInt(localStorageGetWithDefault("percentAccuracy", PercentageAccuracy))).change();

    $("#small_gap_time").val(parseInt(localStorageGetWithDefault("small_gap_time", SmallGapMs))).change();
    $("#medium_gap_time").val(parseInt(localStorageGetWithDefault("medium_gap_time", MediumGapMs))).change();
    $("#large_gap_time").val(parseInt(localStorageGetWithDefault("large_gap_time", LargeGapMs))).change();

    for (var i = 0; i < COL_CNT; ++i) {
        $("#col-visibility-" + i).prop("checked", localStorageGetWithDefault("col-visibility-" + i, "true") === "true").change();
    }

    $("#outliers").prop("checked", localStorageGetWithDefault("remove_outliers", "false") === "true").change();
    $("#allSplitsSelected").prop("checked", localStorageGetWithDefault("allSplitsSelected", "false") === "true").change();
});
