const test=require('node:test'),assert=require('node:assert/strict'),widget=require('../src/main/widget-window');
test('both shapes fit the available work area and preserve size on small screens',()=>{
 assert.deepEqual(widget.dimensions({widgetSize:380,widgetShape:'panel'},{width:1920,height:1080}),{width:380,height:494});
 assert.deepEqual(widget.dimensions({widgetSize:700,widgetShape:'circle'},{width:800,height:600}),{width:600,height:600});
 assert.deepEqual(widget.dimensions({widgetSize:700,widgetShape:'panel'},{width:800,height:600}),{width:600,height:600});
});
test('edge snapping supports negative monitor coordinates and can be disabled',()=>{
 const area={x:-1920,y:40,width:1920,height:1040},bounds={x:-1911,y:920,width:380,height:494};
 assert.deepEqual(widget.fit(bounds,area,true),{x:-1920,y:586,width:380,height:494});
 assert.equal(widget.fit(bounds,area,false).x,-1911);
 assert.equal(widget.fit({x:-384,y:44,width:380,height:380},area,true).x,-380);
});
test('a removed monitor falls back to a visible centered widget; an available saved position is restored',()=>{
 const display={workArea:{x:0,y:0,width:1920,height:1080}};
 const result=widget.savedBounds({widgetSize:380,widgetShape:'panel',widgetPosition:{x:-1800,y:100}},[display],display);
 assert.deepEqual(result,{x:770,y:293,width:380,height:494});
 assert.deepEqual(widget.savedBounds({widgetSize:380,widgetPosition:{x:100,y:90}},[display],display),{x:100,y:90,width:380,height:380});
});
