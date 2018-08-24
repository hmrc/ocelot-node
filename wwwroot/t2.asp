<%

    function dump(y) {
        Response.Write(typeof y  +"\n");
        Response.Write(y + "\n")
    }

    var x1 = Request.QueryString("x").item;
    var x2 = Request.QueryString("x").item();
    dump(x1);
    dump(x2);
%>