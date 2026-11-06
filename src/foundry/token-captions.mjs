// Elevation modules own the native tooltip. Tactical captions use a separate
// child so neither module rewrites the other's PIXI text or rebuilds its texture.
export class TokenCaptions {
  constructor(){this.displays=new Map();}
  get(token){return this.displays.get(token);}
  remove(token){
    const display=this.get(token);this.displays.delete(token);
    if(display&&!display.destroyed){display.parent?.removeChild(display);display.destroy();}
  }
  clear(){for(const token of this.displays.keys())this.remove(token);}
  update(token,text){
    if(!text||token.destroyed){this.remove(token);return;}
    const Text=globalThis.foundry?.canvas?.containers?.PreciseText;
    if(!Text||!token.tooltip||!token.addChild)return;
    let display=this.get(token);
    if(!display||display.destroyed||display.parent!==token){
      this.remove(token);
      display=new Text(text,token.tooltip.style.clone());
      display.name='pf2e-tactical-caption';display.eventMode='none';display.anchor.set(0.5,1);
      token.addChild(display);this.displays.set(token,display);
    }
    if(display.text!==text)display.text=text;
    this.layout(token);
  }
  layout(token){
    const display=this.get(token),tooltip=token.tooltip;
    if(!display||display.destroyed||!tooltip)return;
    display.visible=tooltip.visible!==false&&!token.document.isSecret;
    display.scale.set(tooltip.scale.x,tooltip.scale.y);
    display.x=tooltip.x;
    display.y=tooltip.y-(tooltip.text?tooltip.height:0)-3*tooltip.scale.y;
  }
}
