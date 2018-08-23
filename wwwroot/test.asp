Hello
<% 
    var x = Request.QueryString("a").item;

    Response.Write(x + "\n");

    Response.Write("Hello, world!"); 

    var total = 10;
%>
World "Quotes"
<% 
    var i;
    for (i = 0; i < total; i += 1) {
        Response.Write(i + "\n");
    }
 %>

Whoop!

<!-- #include file="include.inc" -->