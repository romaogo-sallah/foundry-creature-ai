// Reactions can nest (for example Shield Block against Reactive Strike).
// Manual movement and AI use the same awaited barrier on the active GM.
export class ReactionBarrier {
  constructor(){this.active=new Set();this.waiters=new Set();}
  get pending(){return this.active.size>0;}
  async resolve(operation){
    const ticket=Symbol('reaction');this.active.add(ticket);
    try{return await operation();}finally{this.active.delete(ticket);if(!this.pending)for(const wake of [...this.waiters])wake();}
  }
  async wait({signal}={}){
    while(this.pending&&!signal?.aborted)await new Promise(resolve=>{
      const wake=()=>{this.waiters.delete(wake);signal?.removeEventListener('abort',wake);resolve();};
      this.waiters.add(wake);signal?.addEventListener('abort',wake,{once:true});if(signal?.aborted||!this.pending)wake();
    });
    return !signal?.aborted;
  }
}
