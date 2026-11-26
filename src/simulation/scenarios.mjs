export const combatLabScenarios=[
  {id:'melee-routes-around-wall',name:'Melee route around a wall',seed:11,maxRounds:6,
    description:'A melee bruiser must use path progress around a solid divider, then attack instead of ending or oscillating.',
    map:['###########','#B...#....T','#....#.....','#..........','###########'],
    actors:[
      {id:'bruiser',marker:'B',glyph:'B',team:'red',hp:48,ac:19,speed:25,reach:5,strikes:[{id:'club',name:'Club',bonus:12,damage:10}]},
      {id:'target',marker:'T',glyph:'T',team:'blue',hp:30,ac:18,speed:20,reach:5,strikes:[{id:'fist',name:'Fist',bonus:8,damage:5}]},
    ],expect:{winner:'red',actorDefeated:['target'],requireActions:['stride','strike'],forbidFindings:['no-progress-round','two-cell-cycle']}},
  {id:'ranged-closes-before-bad-shot',name:'Ranged attacker closes before a bad shot',seed:7,maxRounds:5,
    description:'A javelin user begins three increments away. The hierarchy should value closing into the first increment over an avoidable penalized throw.',
    map:['##############','#J..........T#','#............#','##############'],
    actors:[
      {id:'javelin',marker:'J',glyph:'J',team:'red',hp:42,ac:19,speed:25,reach:5,
        strikes:[{id:'javelin',name:'Javelin',bonus:13,damage:8,rangeIncrement:30},{id:'fist',name:'Fist',bonus:11,damage:6}]},
      {id:'target',marker:'T',glyph:'T',team:'blue',hp:36,ac:19,speed:20,reach:5,strikes:[{id:'club',name:'Club',bonus:9,damage:6}]},
    ],expect:{winner:'red',actorDefeated:['target'],requireActions:['stride','strike'],forbidFindings:['avoidable-range-penalty','no-progress-round']}},
  {id:'hazard-detour',name:'Hazard-aware approach',seed:19,maxRounds:6,hazardDamage:12,
    description:'A direct lane crosses a costly hazard. The virtual snapshot exposes safer routes and logs whether tactical scoring still walks into danger.',
    map:['############','#A..^^^...Z#','#..........#','############'],
    actors:[
      {id:'attacker',marker:'A',glyph:'A',team:'red',hp:40,ac:18,speed:25,reach:5,strikes:[{id:'blade',name:'Blade',bonus:12,damage:9}]},
      {id:'opponent',marker:'Z',glyph:'Z',team:'blue',hp:35,ac:18,speed:20,reach:5,strikes:[{id:'blade',name:'Blade',bonus:10,damage:7}]},
    ],expect:{winner:'red',actorDefeated:['opponent'],requireActions:['stride','strike'],forbidFindings:['hazard-entry','no-progress-round','two-cell-cycle']}},
];

export const scenarioById=id=>combatLabScenarios.find(scenario=>scenario.id===id);
