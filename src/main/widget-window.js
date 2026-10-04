const size = value => Math.max(260, Math.min(700, Math.round(Number(value) || 380)));
function dimensions(settings, area) {
  const width = Math.min(size(settings.widgetSize), area.width, area.height);
  return {width, height: settings.widgetShape === 'panel' ? Math.min(Math.round(width * 1.3), area.height) : width};
}
function fit(bounds, area, snap = false) {
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  let x=Math.max(area.x,Math.min(Math.round(bounds.x),area.x+area.width-width));
  let y=Math.max(area.y,Math.min(Math.round(bounds.y),area.y+area.height-height));
  if(snap){if(x-area.x<=18)x=area.x;else if(area.x+area.width-width-x<=18)x=area.x+area.width-width;
    if(y-area.y<=18)y=area.y;else if(area.y+area.height-height-y<=18)y=area.y+area.height-height;}
  return {x,y,width,height};
}
function savedBounds(settings, displays, current) {
  const saved=settings.widgetPosition;
  const display=saved&&displays.find(({workArea:a})=>saved.x+80<a.x+a.width&&saved.y+80<a.y+a.height&&saved.x+size(settings.widgetSize)-80>a.x&&saved.y+size(settings.widgetSize)-80>a.y);
  const area=(display||current).workArea, dimensions_=dimensions(settings,area);
  const position=display?saved:{x:area.x+Math.floor((area.width-dimensions_.width)/2),y:area.y+Math.floor((area.height-dimensions_.height)/2)};
  return fit({...position,...dimensions_},area);
}
module.exports={size,dimensions,fit,savedBounds};
