// Describe the selected action, without inventing numeric advantages or exposing
// target statistics. These are presentation templates, not additional AI rules.
export function actionIntent({profileId,choice,state={}}){
  if(!choice||choice.kind==='endTurn')return null;
  const animal=profileId==='wolf',enemy=state.enemies?.find(enemy=>enemy.id===choice.targetId);
  const retreat=choice.intent==='retreat'||choice.features?.retreat,again=(state.attacksMade??0)%2===1;
  if(retreat)return animal?'A frightened whine; the wolf looks for a way out.':'This fight is lost. Get out while we can!';
  switch(choice.kind){
    case 'fly':return choice.features?.flightRetreat?'The flyer pulls away, beyond its prey’s reach.':choice.intent==='climb before hunting'?'The eagle climbs, watching the battlefield below.':choice.features?.hover?'The eagle beats its wings, watching for an opening.':choice.intent==='survey from safe altitude'?'The eagle circles high above, watching its prey.':choice.features?.diveSetup?'The eagle climbs, watching for a chance to swoop.':'The eagle wheels through the air toward its prey.';
    case 'eagleDive':return 'Wings fold; the eagle dives with talons extended.';
    case 'castSpell':return choice.features?.preparation?'Come closer, longshanks. Watch your feet!':choice.spellSlug==='breathe-fire'?'All together? Good. More things to burn!':choice.spellSlug==='grease'?'Try running over this, longshanks!':choice.spellSlug==='tangle-vine'?'Stay there. The vines have you!':'Burn, burn, burn!';
    case 'goblinScuttle':return 'Make room! I have a better spot!';
    case 'strike':
      if(animal)return choice.packAttack?'A sharp bark; the wolf closes in with its pack.':enemy?.prone?'The wolf lunges at the fallen prey.':again?'Teeth flash as the wolf presses its attack.':'A low growl; the wolf bares its teeth and lunges.';
      if(profileId==='kobold-scout')return choice.features?.groupGoal==='kite'?'Shoot, then keep our distance. Keep them chasing!':choice.features?.groupGoal==='swarm'?'Keep it busy. We are closing in!':enemy?.prone||enemy?.offGuard?'You left yourself open. This is my chance!':enemy?.stealthChance>0?'If they lost sight of me, this is my chance!':'Hold still. I only need one good opening.';
      if(choice.features?.frontline&&state.style?.enabled&&!state.frontlineEngaged)return "Let's see how tough you really are!";
      if(enemy?.prone)return 'Stay down. You are easier to reach there!';
      if(choice.features?.ranged)return 'You cannot stay out of my reach forever!';
      return again?'I am not finished with you yet!':'There is my opening. Have a taste of this!';
    case 'knockdown':return 'The wolf snaps low, trying to drag its prey off its feet.';
    case 'trip':return 'On your back! Then you get the hook.';
    case 'sweepingHook':return 'Down you go, and here comes the hook!';
    case 'reactiveStrike':return 'You left an opening. Not so fast!';
    case 'stand':return animal?'The wolf plants its paws and struggles upright.':'I am not staying down!';
    case 'escape':return animal?'The wolf twists and strains against its bonds.':'Let go! I am breaking free!';
    case 'hide':return animal?'The wolf lowers itself into cover and waits.':state.behavior?.selection?.planId==='lay-low'?'Stay low. Make it lose sight of us.':'Lose sight of me, and you will regret it.';
    case 'seek':return animal?'The wolf sniffs the air and searches the place where its prey vanished.':'Where did you go? There must be a sign of you here.';
    case 'sneak':return animal?'The wolf slips quietly between hiding places.':'Quietly now. Find an opening before they spot me.';
    case 'scamper':return 'Too close! Catch me if you can!';
    case 'reload':return 'One more bolt. Keep them busy!';
    case 'bellow':return 'Get moving! Close in on them together!';
    case 'regrip':return 'Both hands. Now I am ready for you!';
    case 'drawJavelin':return 'Too far away? I have something for that.';
    case 'drawRefuse':return 'This will do. Now hold still!';
    case 'drawMelee':return 'Close enough. Time for the axe!';
    case 'drawSword':return choice.features?.groupGoal==='melee'?'No bolts left. Blades out!':choice.features?.groupGoal==='swarm'?'Swords out! Get around it together!':'Too close for the bow. Out comes the blade!';
    case 'stow':return 'Put this away. I need my other hand.';
    case 'stowSword':return 'Back to the bow. Keep your distance.';
    case 'gripBow':return 'Steady the bow. Find the shot.';
    case 'stride':case 'step':case 'crawl':case 'escapeStride':
      if(choice.features?.avoidance)return animal?'The wolf backs away, guarding its wounds.':'Too dangerous here. I need some distance!';
      if(choice.features?.defensiveSetup)return 'Into cover. Let them come to me.';
      if(choice.features?.casterPosition)return 'A little room. A better place to cast.';
      if(choice.features?.groupGoal==='melee')return 'Close in. I can still fight with this blade!';
      if(choice.features?.groupGoal==='swarm')return 'Around the other side! It cannot face all of us.';
      if(choice.features?.groupGoal==='kite')return 'Fall back and keep shooting. Make them come to us!';
      if(choice.features?.investigation)return animal?'The wolf sniffs around, searching for a way to its prey.':'I will look from over there. You cannot hide forever.';
      if(choice.features?.rangedFollowUp)return 'Closer. I need a better angle for this throw.';
      if(choice.intent?.includes('regain sight'))return animal?'Nose low, the wolf circles toward the last place it saw its prey.':'You were just here. I will find you.';
      if(choice.intent==='flank')return animal?'The wolf circles around, trying to hem its prey in.':'Go around. Make them watch both sides!';
      if(choice.intent==='join pack')return 'The wolf answers its pack with a bark and closes in.';
      if(choice.kind==='crawl')return animal?'The wolf drags itself toward its prey.':'I can still get to you from here!';
      if(profileId==='kobold-scout')return choice.intent==='escape melee'?'Back off. I need room to shoot.':choice.features?.stealthLost?'I need a clearer shot, even if they see me move.':'Better cover. A clearer shot. That is where I need to be.';
      return animal?'The wolf stalks closer, watching for an opening.':'You cannot keep me at a distance!';
    default:return animal?'The creature shifts its weight, ready to act.':'Time to make my move.';
  }
}
