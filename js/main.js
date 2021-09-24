const SECTION_COL = 0;
const SPLIT_NAME_COL = 1;
const PB_SPLIT_TIME_COL = 2;
const PB_SEGMENT_TIME_COL = 3;
const AVG_SEGMENT_TIME_COL = 4;
const BEST_SEGMENT_TIME_COL = 5;
const BEST_SEGMENT_DATE_COL = 6;
const RUNS_ENDED_COL = 7;

var SmallGapMs = 5000;
var MediumGapMs = 10000;
var LargeGapMs = 20000;

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
    } else if (gapId === 1) {
        MediumGapMs = parseInt(value);
    } else if (gapId === 2) {
        LargeGapMs = parseInt(value);
    }
}

function toggleColumn(columnId, checkbox) {
    if (checkbox.checked) {
        $(".col-" + columnId).show();
    } else {
        $(".col-" + columnId).hide();
    }
}

var attemptDataTable = [];
var segmentLifetimes = [[]];

function parseFile(file) {
    console.log("Reading " + file);

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
            if (variableCnt > 0) {
                categoryName += ", ";
            }

            // display platform
            if (platform) {
                categoryName += platform;
                if (region) {
                    categoryName += ", ";
                }
            }

            // display region if specified
            if (region) {
                categoryName += region;
            }
            categoryName += ")";
        }
        $("#category").html(categoryName);

        // fill out interesting data
        $("#attempts").html(xmlDoc.getElementsByTagName("AttemptCount")[0].textContent);
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
    // TODO: option to display ms
    return (
        ((total_days > 0) ? total_days + "d " : "")
        + total_hours + ":" 
        + (total_minutes).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false}) + ":" 
        + (total_seconds).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false})
    );
}

function countAttempts(attemptHistory) {
    var completedRuns = 0;
    for (var i = 0; i < attemptHistory.childElementCount; ++i) {
        var attemptData = {};
        var attempt = attemptHistory.children[i];
        if (attempt.children && attempt.children.length > 0) {
            attemptData.finishTime = convertSegmentStrToMs(attempt.children[0].textContent);
            ++completedRuns;
        }

        try {
            attemptData.startTime = convertStrToDate(attempt.attributes['started'].nodeValue);
            attemptData.endTime = convertStrToDate(attempt.attributes['ended'].nodeValue);
            attemptData.duration = attemptData.endTime - attemptData.startTime; // elapsed time in ms
        } catch(error) {

        }
        attemptDataTable.push(attemptData);
    }
    var attemptCount = parseInt($("#attempts").html());
    var completedPercent = Math.trunc(completedRuns / attemptCount * 100);
    $("#completed").html(completedRuns + " (" + completedPercent + "%)");

    // calculate total play time
    var totalPlayTime = 0;
    for (var i = 0; i < attemptDataTable.length; ++i) {
        totalPlayTime += attemptDataTable[i].duration;
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

function trimSegmentTime(time) {
    var decimalIndex = time.lastIndexOf('.');
    if (decimalIndex !== -1) {
        return time.substr(0, decimalIndex);
    } else {
        return time;
    }
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
    segmentLifetimes.length = parseInt($("#attempts").html());
    for (var i = 0; i < segmentLifetimes.length; ++i) {
        segmentLifetimes[i] = 0;
    }

    for (var i = 0; i < segmentList.length; ++i) {
        var row = document.createElement("tr");
        row.className = "split";
        var segment = segmentList[i];

        var bestTime = segment.getElementsByTagName("BestSegmentTime")[0].textContent.trim();
        var segmentHistory = segment.getElementsByTagName("SegmentHistory")[0];

        totalBestTime += convertSegmentStrToMs(bestTime);

        // calculate information from segment history
        var bestTimeDate = undefined;
        var currentAvg = 0;
        var avgCnt = 0;
        for (var k = 0; k < segmentHistory.childElementCount; ++k) {
            var timeNode = segmentHistory.children[k];
            var timeNodeId = parseInt(timeNode.attributes["id"].nodeValue) - 1;

            // update latest segment a run has been seen at
            segmentLifetimes[timeNodeId] = i + 1; // treat 0 as having not finished a split, so offset by 1 for each completed split

            if (timeNode.children && timeNode.children.length > 0) {
                var segmentTime = timeNode.children[0].textContent.trim();
                currentAvg += convertSegmentStrToMs(segmentTime);
                ++avgCnt;

                // found date best time was recorded
                if (segmentTime === bestTime) {
                    var attemptId = parseInt(timeNode.attributes["id"].nodeValue) - 1;
                    bestTimeDate = attemptDataTable[attemptId].endTime.toLocaleString("en-US", {"dateStyle": "short"});
                }
            }
        }
        currentAvg /= avgCnt;
        if (!isNaN(currentAvg)) {
            totalAvgTime += currentAvg;
        }

        // determine each column's values
        for (var j = 0; j < 8; ++j) {
            var col = document.createElement("td");
            col.className = "col-" + j;

            if (j === SECTION_COL) { // section name
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
                            var fullTime = splitTimes.children[k].children[0].textContent;
                            currentPBTime = currentPBSplitTime;
                            currentPBSplitTime = convertSegmentStrToMs(fullTime);
                            col.innerHTML = trimSegmentTime(fullTime);
    
                            // final split time
                            if (i === segmentList.length - 1) {
                                $("#pb_time").html(col.innerHTML);
                                // find pb date
                                var dayOfPB = findDayOfAttempt(fullTime);
                                $("#pb_date").html(dayOfPB);
    
                                // convert from ms->days
                                var daysSincePB = Math.trunc(parseInt(new Date() - new Date(dayOfPB)) / 1000 / 60 / 60 / 24);
                                $("#pb_offset").html(daysSincePB);
                            }
                        }
                    }
                }
            } else if (j === PB_SEGMENT_TIME_COL) { // pb segment time
                var currentPBSegmentTime = currentPBSplitTime - currentPBTime;
                if (currentPBSegmentTime > 0) {
                    var bestMs = convertSegmentStrToMs(bestTime);

                    // set style based on difference from best
                    if (currentPBSegmentTime > bestMs + LargeGapMs) {
                        col.className += " large_gap";
                    } else if (currentPBSegmentTime > bestMs + MediumGapMs) {
                        col.className += " medium_gap";
                    } else if (currentPBSegmentTime > bestMs + SmallGapMs) {
                        col.className += " small_gap";
                    } 

                    col.innerHTML = convertMsToTimeString(currentPBSegmentTime);
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
                col.innerHTML = trimSegmentTime(bestTime);
            } else if (j === BEST_SEGMENT_DATE_COL) { // best segment time date
                col.innerHTML = bestTimeDate;
            } else if (j === RUNS_ENDED_COL) { // resets during this split
                col.id = "resets-" + i;
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
            $("#finished_run_days").html(Math.trunc(msSinceLastRun / 1000 / 60 / 60 / 24));
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

    for (var i = 0; i < runsDeadAtSegment.length; ++i) {
        var count = runsDeadAtSegment[i];
        if (count > 0) {
            var percentage = Math.trunc(count / parseInt($("#attempts").html()) * 100)
            $("#resets-" + i).html(count + " (" + percentage + "%)");
        }
    }
}

function preventDefaultDrag(event) {
    event.preventDefault();
}
