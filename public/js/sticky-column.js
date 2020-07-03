document.addEventListener('DOMContentLoaded', (event) => {
    let left = (document.getElementsByClassName('slo-text')[0].offsetWidth - 1) + "px";

    let cells = document.getElementsByClassName('pslo-support');
    for(let i = 0; i < cells.length; i++) {
        cells[i].style.left = left;
    }
});