export const organs = [
  { id: 'heart', name: 'Heart', system: 'Cardiovascular', description: 'Four chambers keep blood moving through the lungs and the rest of the body.', color: '#c75f50', icon: 'heart' },
  { id: 'lung_l', name: 'Left lung', system: 'Respiratory', description: 'The left lung has two lobes. Its cardiac notch makes space for the heart.', color: '#d99175', icon: 'lungs' },
  { id: 'lung_r', name: 'Right lung', system: 'Respiratory', description: 'The right lung has three lobes. Its airways branch down to alveoli, where oxygen and carbon dioxide are exchanged.', color: '#d79578', icon: 'lungs' },
  { id: 'liver', name: 'Liver', system: 'Digestive', description: 'The liver processes nutrients and makes bile, which helps the small intestine digest fats.', color: '#aa745a', icon: 'cube' },
  { id: 'stomach', name: 'Stomach', system: 'Digestive', description: 'Muscles churn food together with acid and enzymes to begin breaking down proteins.', color: '#c9947f', icon: 'cube' },
  { id: 'kidney_l', name: 'Left kidney', system: 'Urinary', description: 'This kidney filters blood and helps regulate water and salts. It sits slightly higher than the right kidney.', color: '#a47176', icon: 'cube' },
  { id: 'kidney_r', name: 'Right kidney', system: 'Urinary', description: 'This kidney filters blood and makes urine. It sits below the liver, slightly lower than the left kidney.', color: '#a47176', icon: 'cube' },
  ...[
    ['brain', 'Brain', 'Nervous', 'Processes sensory information and coordinates movement, thought, and other body functions.'],
    ['cerebellum', 'Cerebellum', 'Nervous', 'Helps coordinate balance and the timing of movements.'],
    ['brainstem', 'Brainstem', 'Nervous', 'Connects the brain with the spinal cord and helps regulate breathing and other vital functions.'],
    ['eye_l', 'Left eye', 'Sensory', 'Detects light and sends visual information to the brain.'],
    ['eye_r', 'Right eye', 'Sensory', 'Detects light and sends visual information to the brain.'],
    ['pituitary', 'Pituitary gland', 'Endocrine', 'Releases hormones that regulate growth and influence other endocrine glands.'],
    ['tongue', 'Tongue', 'Digestive', 'Helps with taste, speech, and moving food during swallowing.'],
    ['salivary_glands', 'Salivary glands', 'Digestive', 'Produce saliva to moisten food and begin starch digestion.'],
    ['pharynx', 'Pharynx', 'Respiratory', 'A passage in the throat used by both air and swallowed food.'],
    ['larynx', 'Larynx', 'Respiratory', 'Houses the vocal folds and helps protect the airway during swallowing.'],
    ['trachea', 'Trachea', 'Respiratory', 'Carries air to the two main bronchi.'],
    ['bronchi', 'Bronchi', 'Respiratory', 'Carry air from the trachea toward each lung.'],
    ['esophagus', 'Esophagus', 'Digestive', 'Moves swallowed food to the stomach by muscular contractions.'],
    ['thymus', 'Thymus', 'Immune', 'Provides a site for T cells to develop.'],
    ['gallbladder', 'Gallbladder', 'Digestive', 'Stores and concentrates bile made by the liver.'],
    ['pancreas', 'Pancreas', 'Digestive', 'Releases digestive enzymes and makes hormones including insulin.'],
    ['spleen', 'Spleen', 'Immune', 'Filters blood and contributes to immune responses.'],
    ['small_intestine', 'Small intestine', 'Digestive', 'Completes much of digestion and absorbs most nutrients.'],
    ['colon', 'Colon', 'Digestive', 'Absorbs water and salts and moves material toward the rectum.'],
    ['appendix', 'Appendix', 'Digestive', 'A small pouch attached to the cecum with lymphoid tissue.'],
    ['adrenal_l', 'Left adrenal gland', 'Endocrine', 'Sits above the kidney and produces hormones including cortisol and aldosterone.'],
    ['adrenal_r', 'Right adrenal gland', 'Endocrine', 'Sits above the kidney and produces hormones including cortisol and aldosterone.'],
    ['ureter_l', 'Left ureter', 'Urinary', 'Carries urine from the left kidney to the bladder.'],
    ['ureter_r', 'Right ureter', 'Urinary', 'Carries urine from the right kidney to the bladder.'],
    ['bladder', 'Urinary bladder', 'Urinary', 'Stores urine until it is released.'],
    ['prostate', 'Prostate', 'Reproductive', 'A gland below the bladder that contributes fluid to semen.'],
    ['reproductive', 'Male reproductive structures', 'Reproductive', 'A grouped mesh of structures in the male reproductive system.']
  ].map(([id, name, system, description]) => ({
    id, name, system, description, icon: 'cube',
    color: { Nervous: '#bdad91', Sensory: '#cfcebb', Endocrine: '#c6a371', Digestive: '#be8d74',
      Respiratory: '#cfaa8a', Immune: '#a87984', Urinary: '#b6a187', Reproductive: '#a88189' }[system]
  }))
];

export const poseLayers = [
  { id: 'mixed', name: 'Skeleton + organs' },
  { id: 'muscles', name: 'Muscles' },
  { id: 'organs', name: 'Organs' }
];

export const chestIds = ['heart', 'lung_l', 'lung_r'];
export const targetIds = ['lung_r', 'lung_l', 'heart'];
export const roundSeconds = 90;

export const layers = [
  { id: 'skeleton', name: 'Skeleton', description: 'The rib cage protects the heart and lungs. Rotate the body to trace the ribs back to the spine.' },
  { id: 'muscles', name: 'Muscles', description: 'Muscles between the ribs help change the size of the chest as you breathe. Rotate the model to compare the front and back.' },
  { id: 'organs', name: 'Organs', description: 'The lungs lie on either side of the heart. Compare their position with the rib cage in the Skeleton layer.' }
];

export const heartParts = {
  'aortic-arch': { name: 'Aortic arch', color: '#e88361', description: 'The arch curves over the heart and carries oxygen-rich blood from the left ventricle toward the body.' },
  'ascending-aorta': { name: 'Ascending aorta', color: '#d87b64', description: 'The first segment of the aorta carries blood out of the left ventricle.' },
  'pulmonary-trunk': { name: 'Pulmonary trunk', color: '#9aa8dd', description: 'This vessel carries oxygen-poor blood from the right ventricle and branches toward the two lungs.' },
  'superior-vena-cava': { name: 'Superior vena cava', color: '#969fc0', description: 'This vein brings blood from the upper body to the right atrium.' },
  'ventricular-wall': { name: 'Ventricular wall', color: '#b8584b', description: 'The muscular wall contracts to send blood from the ventricles to the lungs and the rest of the body.' },
  'right-atrium': { name: 'Right atrium', color: '#b98ab7', description: 'This receiving chamber collects blood returning from the body and passes it to the right ventricle.' },
  'left-atrium': { name: 'Left atrium', color: '#e4a082', description: 'This chamber receives oxygen-rich blood from the lungs and passes it into the left ventricle. Rotate the heart to see it from the back.' },
  'right-ventricle': { name: 'Right ventricle', color: '#898fc9', description: 'This chamber pumps blood toward the lungs. The blue surface shows the space inside the ventricle.' },
  'left-ventricle': { name: 'Left ventricle', color: '#dd8d65', description: 'This chamber pumps blood into the aorta. The orange surface shows the space inside the ventricle.' },
  'left-coronary': { name: 'Left coronary arteries', color: '#efae88', description: 'These branches carry oxygen-rich blood to the heart muscle.' },
  'right-coronary': { name: 'Right coronary arteries', color: '#efae88', description: 'These branches carry oxygen-rich blood to the heart muscle.' }
};

export const heartViews = {
  outside: ['aortic-arch', 'ascending-aorta', 'pulmonary-trunk', 'superior-vena-cava', 'ventricular-wall'],
  inside: ['right-atrium', 'left-atrium', 'right-ventricle', 'left-ventricle']
};

export const airways = {
  trachea: { name: 'Trachea', color: '#c7c9a2', description: 'Air moves through the trachea before it splits into the two main bronchi.' },
  bronchi: { name: 'Bronchi', color: '#d6b291', description: 'The bronchi branch into each lung, then divide into smaller airways.' }
};
