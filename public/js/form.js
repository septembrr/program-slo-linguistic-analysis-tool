function updateProgType(selected) {
    clearSelection("prog-type");
    clearSelection("prog-name");

    var deptClass = "dept-" + selected[selected.selectedIndex].id;
    var depts = document.getElementsByClassName(deptClass);
    for (var i = 0; i < depts.length; i++) {
        depts[i].setAttribute('style', "display: block");
    }

    document.getElementsByClassName("prog-type")[0].disabled = false;
    
}

function updateProgName(selected) {
    clearSelection("prog-name");

    var progs = document.getElementsByClassName(selected[selected.selectedIndex].id);
    for (var i = 0; i < progs.length; i++) {
        progs[i].setAttribute('style', "display: block");
    }

    document.getElementsByClassName("prog-name")[0].disabled = false;
}

function updateProgId(selected) {
    document.getElementById("progId").value = selected[selected.selectedIndex].id;
}

function clearSelection(parentClass) {
    if (!document.getElementsByClassName(parentClass)[0].disabled) {
        var progList = document.getElementsByClassName(parentClass)[0];
        var progArray = Array.from(progList.childNodes);
        progArray.forEach(function(element) {
            element.style.display = "none";
            element.selected = false;
        });
        progList.disabled = true;
    }
}