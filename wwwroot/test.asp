Hello
<% 
    var x = Request.QueryString("a").item;

    Response.Write(x + "\n");

    Response.WrITE("Hello, world! (but with mixed case)"); 

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
<script src="bogus.js"></script>
<script>
    console.log("Client side script")
</script>
<script runat="server">
    Response.Write("Server side script")

</script>
<!-- #include file="include.inc" -->