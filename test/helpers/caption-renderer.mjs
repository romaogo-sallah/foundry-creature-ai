export function captionRenderer(tokens){
  const point=(x=1,y=1)=>({x,y,set(a,b=a){this.x=a;this.y=b;}});
  const style=()=>({fontSize:24,clone(){return style();}});
  class Text {
    constructor(text='',options=style()) {this.value=text;this.writes=0;this.style=options;this.scale=point();this.anchor=point();this.visible=true;this.x=0;this.y=-2;}
    get text(){return this.value;}
    set text(value){this.value=value;this.writes++;}
    get height(){return Math.max(1,this.value.split('\n').length)*20;}
    destroy(){this.parent?.removeChild(this);this.destroyed=true;}
  }
  globalThis.foundry??={};foundry.canvas??={};foundry.canvas.containers??={};foundry.canvas.containers.PreciseText=Text;
  for(const token of tokens){
    token.children=[];token.tooltip=new Text();token.tooltip.x=token.w/2;
    token.addChild=display=>{display.parent=token;token.children.push(display);return display;};
    token.removeChild=display=>{token.children=token.children.filter(child=>child!==display);display.parent=null;};
    token.renderFlags={set:()=>{}};
    token._getTooltipText=()=>token.document.elevation?`+${token.document.elevation} ft`:'';
    token._refreshTooltip=()=>{token.tooltip.text=token._getTooltipText();};
  }
}
