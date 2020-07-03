if (document.getElementById("weight-toggle")) {
    document.getElementById("weight-toggle").addEventListener("change", function(event){
        let weights = document.getElementsByClassName("match-weight-value");
        if(event.target.checked) {
            for(let i = 0; i < weights.length; i++) {
                weights[i].style.display = "block";
            }
        } else {
            for(let i = 0; i < weights.length; i++) {
                weights[i].style.display = "none";
            }
        }
    });
}
