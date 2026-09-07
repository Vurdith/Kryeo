import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';

const { encodeEmbedding } = await import('../src/main/embedding-utils.ts');
const { strictProductionName } = await import('../src/main/asset-intelligence-service.ts');
const { applyComponentIntelligence } = await import('../src/main/component-intelligence-service.ts');
const { applyComponentSceneContext } = await import('../src/main/component-context-service.ts');
const {
  applyApprovedFamilies,
  applyAssetBoundaries,
  applyHostedFamilyAnalyses,
  buildVisualFamilies,
  familyBatchConsistencyIssues,
  familyDecisionConsistencyIssues,
  familyPrimaryEvidenceIssues,
  familySourceIdentityLeakageIssues,
  finalizeFamilyDecisionContract,
  harmonizeFamilyNames,
  planHostedFamilyReview,
  familySourceTypeHint,
  requiresIndependentFamilyReview,
  resolveChallengedFamilyAnalysis,
  resolveIndependentFamilyAnalysis,
  resolvePrimaryFamilyAnalysis,
  visualStructureAnchor,
} = await import('../src/main/component-family-service.ts');

const gatewaySource = await fs.readFile(new URL('../services/ai-server/src/server.mjs', import.meta.url), 'utf8');
const desktopSource = await fs.readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const hostedServiceSource = await fs.readFile(new URL('../src/main/hosted-ai-service.ts', import.meta.url), 'utf8');
assert.match(gatewaySource, /KRYEO_AI_FAMILY_BATCH_SIZE \|\| 10/, 'Cloud classification must use bounded batches that avoid shared-provider request bursts.');
assert.match(gatewaySource, /KRYEO_AI_ESTIMATED_OUTPUT_TOKENS_PER_FAMILY \|\| 40/, 'Cloud budgeting must retain the measured compact-packet estimate.');
assert.match(gatewaySource, /compactOutputFloor = MODEL_TRANSPORT === 'responses' \? 700 : 360/, 'Compact packets must retain bounded output headroom for each provider transport.');
assert.match(gatewaySource, /Direct image inputs preserve the pixel detail of every member/, 'The gateway must use direct labelled family previews by default.');
assert.match(gatewaySource, /sourceTypeHint.*hierarchyTypeHint/, 'Cloud prompts must carry generic source and hierarchy type evidence.');
assert.match(gatewaySource, /sourceTypeHint.*hierarchyTypeHint/, 'Cloud prompts must carry source and hierarchy context to the visual model.');
assert.doesNotMatch(gatewaySource, /sourceTypeConflict/, 'Source or hierarchy context must never locally override or gate the model decision.');
assert.match(gatewaySource, /preview is compatible with more than one UI shell/i, 'A direct target cue may resolve a genuinely ambiguous UI-shell reading without becoming a blind override.');
assert.match(gatewaySource, /direct sibling sourceName values are meaningfully different/, 'Cloud prompts must preserve distinct source-labelled sibling identities.');
assert.match(hostedServiceSource, /const REQUIRED_ANALYSIS_VERSION = 'family-v83'/, 'Desktop and gateway must share the current decision contract.');
assert.match(hostedServiceSource, /recovery: z\.record\(z\.string\(\), z\.union\(\[/, 'Reviewer diagnostics may include both counters and family-ID arrays without invalidating a complete review response.');
assert.match(gatewaySource, /A name is a stable asset identifier, not an art caption/, 'Cloud prompts must treat names as concise identifiers rather than descriptive captions.');
assert.match(gatewaySource, /Editor-default construction tokens/, 'Cloud packets must reject generic editor scaffolding instead of publishing Layer or Group as a visual identity.');
assert.match(gatewaySource, /Never copy a parent, ancestor, sibling, or collection identity into the target name/, 'Cloud prompts must forbid ancestor identity leakage without hardcoding a document label.');
assert.match(gatewaySource, /function sourceIdentityLeakageIssue/, 'The gateway must route a copied-ancestor name through a complete visual replacement.');
assert.match(gatewaySource, /A direct source-type cue from the target label is creator intent/, 'A meaningful direct target type cue must win genuinely ambiguous UI-shell readings without being a project-specific rule.');
assert.match(gatewaySource, /Panel is a broad non-interactive content surface, not a catch-all for compact grouped art/, 'The visual taxonomy must distinguish a Panel from compact controls without mapping a document-specific label to a type.');
assert.match(gatewaySource, /compact visual with an inset, item well, state marker, or repeated-cell function is not a Panel/, 'The visual contract must describe generic Panel/Slot evidence rather than forcing a local replacement from a source name.');
assert.match(gatewaySource, /hasDirectTargetTypeDisagreement/, 'Direct target type disagreements must receive full visual review context rather than a cheap compact-only retry.');
assert.match(gatewaySource, /Never invent style, era, mood, lore, brand, or story details/, 'Cloud prompts must reject speculative naming while permitting one obvious useful descriptor.');
assert.match(gatewaySource, /ROLE_FOR_ASSET_TYPE/, 'The gateway must validate one generic Roblox type-to-role output contract without inventing a visual decision.');
assert.match(gatewaySource, /hasCompatibleRobloxRole\(analysis\.assetType, analysis\.role\)/, 'An incompatible model packet must be returned for visual replacement rather than treated as export-ready.');
assert.match(gatewaySource, /return classifyFamilyBatch\(families, context, \[\], signal, model\)/, 'The primary visual lane must make one atomic decision rather than blocking on a separate observation call.');
assert.match(gatewaySource, /isModelProtocolError\(error\) \|\| retryIncompletePacket/, 'Malformed packets and incomplete reviewer recovery decisions must be retried before a family is failed.');
assert.match(gatewaySource, /semanticNameRecoveryBatches[\s\S]{0,1200}analyzeCompleteFamilyBatchWithRetry/, 'Small detail name-recovery batches must retry incomplete semantic packets rather than leaving generic fallback labels after one transient provider failure.');
assert.match(gatewaySource, /compactResponse: !recoveryHasDirectTargetTypeDisagreement/, 'A direct target-type disagreement must retain detailed target evidence through its recovery path; unrelated recovery remains compact.');
assert.match(gatewaySource, /runDetailedReplacement[\s\S]{0,4000}analyzeCompleteFamilyBatchWithRetry/, 'Independent-review detail recovery must receive the same bounded semantic/provider retry path as primary analysis.');
assert.match(gatewaySource, /function isDirectCueConsistentReviewPacket/, 'A complete review decision aligned with the target’s own type cue must not be overwritten solely because another batch row is incomplete.');
assert.match(gatewaySource, /generate a fresh name containing that final type exactly once and no other asset-type word/, 'A reviewer must replace a rejected mixed-taxonomy name atomically instead of repeating it.');
assert.match(gatewaySource, /retrySemanticIncomplete: false/, 'An already-detailed reviewer replacement must not spend a third semantic call repeating the same invalid packet.');
assert.match(desktopSource, /hostedAi\.reviewFamilies/, 'Scan-time disagreements must use bounded batch visual review.');
assert.match(desktopSource, /directTypeChallenges[\s\S]{0,700}reviewBatches\.push\(\[analysis\]\)/, 'Direct target-type disagreements must be isolated from sibling naming repairs so a rich visual review cannot time out an entire family scope.');
assert.match(desktopSource, /directCueEscalation[\s\S]{0,220}sourceTypeHint/, 'A composed owner with direct type evidence must be identified for detailed first-pass routing.');
assert.match(desktopSource, /eligible for detailed composition evidence when scan capacity allows/, 'The detailed first-pass route must be evidence routing, not a local type replacement.');
assert.match(desktopSource, /Every escalation shares one[\s\S]{0,180}configured capacity/, 'Direct-cue detailed routing must share the bounded scan capacity so it cannot starve later families.');
assert.doesNotMatch(desktopSource, /&& !candidate\.directCueEscalation\s*\n\s*&& escalationCount >= maxEscalations/, 'Direct-cue detailed routing must not bypass the escalation cap.');
assert.match(desktopSource, /reviewApplied:/, 'Developer diagnostics must record an applied reviewer replacement separately from current review state.');
assert.match(desktopSource, /reviewApplied=\$\{outcome\?\.replacementSelected \? 1 : 0\};needsReview=/, 'The compact diagnostic summary must distinguish an applied review from a decision that merely no longer needs review.');
assert.doesNotMatch(desktopSource, /const challenge = await hostedAi\.explainFamily/, 'Scan-time disagreements must not fan out into one provider call per family.');
assert.doesNotMatch(desktopSource, /resolvePrimaryFamilyAnalysis\(/, 'The desktop must not apply local primary-decision overrides.');
assert.match(desktopSource, /responseAnalyses = harmonizeFamilyNames\(responseAnalyses, families\)/, 'The desktop must canonicalize document-order sibling ordinals as part of the final atomic decision application.');
assert.doesNotMatch(desktopSource, /finalizeFamilyDecisionContract\(/, 'The desktop must not rewrite model roles or grouping during finalization.');
assert.match(desktopSource, /family\?\.assetBoundary === 'construction-child'[\s\S]{0,260}parentHierarchyKey/, 'Independent review must keep immediate construction siblings in their own scope.');
assert.doesNotMatch(desktopSource, /pendingBatch\.push\(\.\.\.unit\)/, 'Independent review must not recombine unrelated scopes into one compact model batch.');
assert.match(gatewaySource, /const hasDirectTargetTypeDisagreement = families\.some/, 'Independent review must detect direct target-type conflicts.');
assert.match(gatewaySource, /compactResponse: !hasDirectTargetTypeDisagreement/, 'Independent review must upgrade only direct target-type conflicts to full visual context while retaining compact review for other scopes.');
assert.match(desktopSource, /const unresolvedComponents = reviewed\.filter/, 'Finalization must compute unresolved decisions before publishing scan completion.');
assert.match(desktopSource, /unresolvedComponents\.length[\s\S]{0,700}automatic asset creation/, 'A scan with unresolved decisions must never report that every component is ready.');
assert.match(desktopSource, /Recovering families missing a primary packet/, 'A missing primary packet must enter one bounded recovery lane instead of disappearing.');
assert.doesNotMatch(desktopSource, /immediate-parent-root-plus-final-type-and-document-order/, 'Developer diagnostics must not claim that child names inherit their parent root.');
assert.match(desktopSource, /confidenceBasis: analysis\.evidence \? 'model-evidence' : 'compact-decision-band'/, 'Developer diagnostics must distinguish model evidence from compact decision confidence bands.');
assert.match(hostedServiceSource, /function compactGatewayMember/, 'Gateway requests must send one target preview rather than duplicate UI and hosted thumbnails.');
assert.match(hostedServiceSource, /function compactGatewayContextMember/, 'Gateway context must stay metadata-only so supporting thumbnails cannot inflate the request.');
assert.match(gatewaySource, /Request body exceeded the/, 'Oversized gateway payloads must report an actionable body-limit failure.');
assert.deepEqual(
  strictProductionName('Border 1', 'Border').issues,
  ['The AI name must place the final Border type after its descriptive identity.'],
  'A taxonomy word plus an ordinal is a placeholder and must never become an export-ready decision.',
);

const primaryDecision = {
  familyId: 'atomic-decision', fingerprint: 'atomic', familyName: 'Canvas Frame', assetType: 'Frame', role: 'Frame',
  memberNames: [{ visualHash: 'atomic-hash', name: 'Canvas Frame' }], diveMode: 'keep-together', reason: 'Primary.',
  reviewNeeded: true, alternatives: [],
};
const resolvedDecision = resolveChallengedFamilyAnalysis(primaryDecision, {
  reason: 'Independent visual review found a hollow perimeter.', visualDescription: 'A decorative perimeter.', confidence: 0.91,
  evidence: { visual: 0.94, layerName: 0.1, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'Border is a better match.',
  supportsClassification: false, suggestedName: 'Canvas Border', suggestedType: 'Border', suggestedRole: 'ImageLabel', alternatives: [], cached: false,
});
assert.equal(resolvedDecision.familyName, 'Canvas Border');
assert.equal(resolvedDecision.assetType, 'Border');
assert.equal(resolvedDecision.role, 'ImageLabel');
assert.equal(resolvedDecision.memberNames[0].name, 'Canvas Border');

const incompleteAnonymousConstruction = resolveIndependentFamilyAnalysis({
  ...primaryDecision,
  familyName: 'Layer 1',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: 'anonymous-border', name: 'Layer 1' }],
  reviewNeeded: true,
  conflict: true,
}, undefined, {
  assetBoundary: 'construction-child',
  members: [{ name: 'Layer1', visualHash: 'anonymous-border' }],
  parentNames: ['PerimeterAssembly'],
  siblingOrdinal: 1,
  siblingCount: 2,
  structuralDiveMode: 'keep-together',
});
assert.equal(incompleteAnonymousConstruction.familyName, 'Layer 1', 'Kryeo must not derive a construction name when the model packet is incomplete.');
assert.equal(incompleteAnonymousConstruction.reviewNeeded, true);
assert.equal(incompleteAnonymousConstruction.conflict, true);

const renamedSameTypeDecision = resolveChallengedFamilyAnalysis({
  ...primaryDecision,
  familyName: 'Decorative Scroll Bar',
  assetType: 'Bar',
  role: 'ImageLabel',
}, {
  reason: 'The source identity is visually compatible and the compound subtype is unsupported.', visualDescription: 'A thin status bar.', confidence: 0.9,
  evidence: { visual: 0.9, layerName: 0.7, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'Use one coherent Bar decision.',
  supportsClassification: false, suggestedName: 'Focus Bar', suggestedType: 'Bar', suggestedRole: 'ImageLabel', alternatives: [], cached: false,
});
assert.equal(renamedSameTypeDecision.familyName, 'Focus Bar', 'A complete same-type rename must replace the original decision atomically.');
assert.equal(renamedSameTypeDecision.assetType, 'Bar');

const batchReviewedDecision = resolveIndependentFamilyAnalysis(primaryDecision, {
  ...primaryDecision,
  familyName: 'Decorative Border',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: 'atomic-hash', name: 'Decorative Border' }],
  reason: 'The independent visual batch found a hollow perimeter.',
  reviewNeeded: false,
});
assert.equal(batchReviewedDecision.familyName, 'Decorative Border');
assert.equal(batchReviewedDecision.assetType, 'Border');
assert.equal(batchReviewedDecision.role, 'ImageLabel');
assert.equal(batchReviewedDecision.reviewNeeded, false);
assert.equal(batchReviewedDecision.conflict, false, 'A complete independent replacement is accepted, not left as an export conflict.');
assert.match(batchReviewedDecision.normalizationReason, /complete independent visual replacement|confirmed the complete primary decision/i);
assert.equal(resolvedDecision.conflict, false, 'A complete explain-review replacement is accepted atomically.');

const uncertainButCompleteReview = resolveIndependentFamilyAnalysis(primaryDecision, {
  ...primaryDecision,
  familyName: 'Decorative Border',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: 'atomic-hash', name: 'Decorative Border' }],
  confidence: 0.58,
  reviewNeeded: true,
  alternatives: [{ assetType: 'Frame', reason: 'The perimeter could be structural chrome.' }],
});
assert.equal(uncertainButCompleteReview.familyName, 'Decorative Border');
assert.equal(uncertainButCompleteReview.reviewNeeded, false, 'A complete best answer may be accepted while retaining uncertainty evidence.');
assert.equal(uncertainButCompleteReview.alternatives[0].assetType, 'Frame');

const perimeterStructureFamily = buildVisualFamilies([{
  ...candidate('perimeter-structure', 'v'.repeat(64), 'BorderLayers', { x: 0, y: 0, width: 121, height: 121 }, [0.2, 0.6, 0.2]),
  affinityType: 'GroupNode',
  childHierarchyKeys: ['perimeter-structure.0'],
  visualMetrics: {
    visiblePixelRatio: 0.28,
    opaquePixelRatio: 0.22,
    meanAlpha: 0.25,
    edgeVisibleRatio: 0.01,
    centerVisibleRatio: 0.22,
    innerVisibleRatio: 0.01,
    contentPerimeterVisibleRatio: 0.24,
    contentPerimeterCoverage: 0.86,
  },
}], [], 'Project', 'Document')[0];
const perimeterStructureDecision = resolveIndependentFamilyAnalysis(
  {
    ...primaryDecision,
    familyId: perimeterStructureFamily.id,
    fingerprint: perimeterStructureFamily.fingerprint,
    familyName: 'Ornate Frame',
    assetType: 'Frame',
    role: 'Frame',
    memberNames: [{ visualHash: perimeterStructureFamily.members[0].visualHash, name: 'Ornate Frame' }],
  },
  {
    ...primaryDecision,
    familyId: perimeterStructureFamily.id,
    fingerprint: perimeterStructureFamily.fingerprint,
    familyName: 'Ornate Frame',
    assetType: 'Frame',
    role: 'Frame',
    memberNames: [{ visualHash: perimeterStructureFamily.members[0].visualHash, name: 'Ornate Frame' }],
    reviewNeeded: false,



    conflict: true,
  },
  perimeterStructureFamily,
);
assert.equal(perimeterStructureDecision.assetType, 'Frame', 'Rendered structure is model evidence, not a local type override.');
assert.equal(perimeterStructureDecision.role, 'Frame');
assert.equal(perimeterStructureDecision.familyName, 'Ornate Frame');
assert.equal(perimeterStructureDecision.memberNames[0].name, 'Ornate Frame');
assert.equal(perimeterStructureDecision.reviewNeeded, false);
assert.equal(perimeterStructureDecision.conflict, false);
const finalizedPerimeterDecision = finalizeFamilyDecisionContract({
  ...perimeterStructureDecision,
  role: 'Frame',
  diveMode: 'keep-together',
}, {
  ...perimeterStructureFamily,
  structuralDiveMode: 'children-only',
});
assert.equal(finalizedPerimeterDecision.assetType, 'Frame');
assert.equal(finalizedPerimeterDecision.role, 'Frame', 'Kryeo must not locally remap the model role.');
assert.equal(finalizedPerimeterDecision.diveMode, 'keep-together', 'Kryeo must preserve the model grouping packet.');
assert.ok(!familyDecisionConsistencyIssues({
  ...finalizedPerimeterDecision,
  familyName: 'Decorative Corner Border',
  memberNames: [{ visualHash: perimeterStructureFamily.members[0].visualHash, name: 'Decorative Corner Border' }],
}, perimeterStructureFamily).some((issue) => /type that disagrees/i.test(issue)), 'Border construction subtypes such as Corner are compatible name words, not contradictory types.');
assert.ok(!familyDecisionConsistencyIssues({
  ...finalizedPerimeterDecision,
  familyName: 'Decorative Corner',
  assetType: 'Corner',
  role: 'ImageLabel',
  memberNames: [{ visualHash: perimeterStructureFamily.members[0].visualHash, name: 'Decorative Corner' }],
}, perimeterStructureFamily).some((issue) => /strong rendered structure/i.test(issue)), 'A Corner is a compatible Border construction subtype, not a visual-structure conflict.');

const incompleteReviewKeepsCompletePrimary = resolveIndependentFamilyAnalysis({
  ...primaryDecision,
  familyName: 'Canvas Frame',
  assetType: 'Frame',
  role: 'Frame',
  conflict: true,
  reviewNeeded: true,
}, undefined);
assert.equal(incompleteReviewKeepsCompletePrimary.familyName, 'Canvas Frame');
assert.equal(incompleteReviewKeepsCompletePrimary.assetType, 'Frame');
assert.equal(incompleteReviewKeepsCompletePrimary.reviewNeeded, false, 'An unavailable reviewer must retain a complete primary decision instead of blanking a usable layer name.');
assert.equal(incompleteReviewKeepsCompletePrimary.conflict, false);
assert.match(incompleteReviewKeepsCompletePrimary.normalizationReason, /complete primary/i);

const unresolvedDecision = resolveChallengedFamilyAnalysis(primaryDecision, {
  reason: 'The independent reviewer disagreed but could not read the preview clearly.', visualDescription: 'Tiny ambiguous artwork.', confidence: 0.43,
  evidence: { visual: 0.43, layerName: 0.1, hierarchy: 0.2, learned: 0 }, conflict: true, conflictMessage: 'The primary decision is not sufficiently supported.',
  supportsClassification: false, suggestedName: 'Possible Border', suggestedType: undefined, suggestedRole: undefined, alternatives: [{ assetType: 'Border', reason: 'A perimeter may be present.' }], cached: false,
});
assert.equal(unresolvedDecision.familyName, primaryDecision.familyName, 'An incomplete challenge must not partially replace a decision.');
assert.equal(unresolvedDecision.assetType, primaryDecision.assetType);
assert.equal(unresolvedDecision.reviewNeeded, true, 'An incomplete rejected decision must remain visibly unresolved.');
assert.equal(unresolvedDecision.conflict, true);

const sourceEvidenceFamily = buildVisualFamilies([
  candidate('source-evidence', 'e'.repeat(64), 'SampleBorder', { x: 0, y: 0, width: 96, height: 96 }, [0.3, 0.2, 0.1]),
], [], 'Project', 'Document')[0];
assert.equal(familySourceTypeHint(sourceEvidenceFamily), 'Border');
assert.equal(requiresIndependentFamilyReview({
  ...primaryDecision,
  familyId: sourceEvidenceFamily.id,
  familyName: 'Canvas Badge',
  assetType: 'Badge',
  role: 'ImageLabel',
  memberNames: [{ visualHash: sourceEvidenceFamily.members[0].visualHash, name: 'Canvas Badge' }],
  confidence: 0.91,
  reviewNeeded: true,
  conflict: true,
}, sourceEvidenceFamily), true, 'A single direct source type cue must route a conflicting visual packet through the independent reviewer.');

const incompleteReviewKeepsRealDisagreementGated = resolveIndependentFamilyAnalysis({
  ...primaryDecision,
  familyName: 'Canvas Frame',
  assetType: 'Frame',
  role: 'Frame',
  conflict: true,
  reviewNeeded: true,
}, undefined, sourceEvidenceFamily);
assert.equal(incompleteReviewKeepsRealDisagreementGated.familyName, 'Canvas Frame', 'A failed reviewer may not erase the primary packet.');
assert.equal(incompleteReviewKeepsRealDisagreementGated.reviewNeeded, true, 'A direct type-evidence disagreement must remain gated until a complete independent visual decision exists.');
assert.equal(incompleteReviewKeepsRealDisagreementGated.conflict, true);
assert.match(incompleteReviewKeepsRealDisagreementGated.conflictMessage, /source type cue suggests Border/i);

const directInteractiveFamily = buildVisualFamilies([
  candidate('direct-interactive', 'i'.repeat(64), 'ActionSlot', { x: 0, y: 0, width: 80, height: 80 }, [0.6, 0.1, 0.1]),
], [], 'Project', 'Document')[0];
const directInteractiveResolution = resolvePrimaryFamilyAnalysis({
  ...primaryDecision,
  familyId: directInteractiveFamily.id,
  fingerprint: directInteractiveFamily.fingerprint,
  familyName: 'Action Frame',
  assetType: 'Frame',
  role: 'Frame',
  memberNames: [{ visualHash: directInteractiveFamily.members[0].visualHash, name: 'Action Frame' }],
  conflict: true,
  reviewNeeded: true,
}, directInteractiveFamily);
assert.equal(directInteractiveResolution.assetType, 'Frame', 'A source cue is context for the model, never a local type override.');
assert.equal(directInteractiveResolution.role, 'Frame');
assert.equal(directInteractiveResolution.familyName, 'Action Frame');

const sourceIdentityFamily = {
  ...buildVisualFamilies([
    candidate('source-identity', 'z'.repeat(64), 'ActionAnchor', { x: 0, y: 0, width: 27, height: 27 }, [0.2, 0.6, 0.2]),
  ], [], 'Project', 'Document')[0],
  parentNames: ['ActionSlot'],
  hierarchyContext: [{ parentName: 'ActionSlot', ancestorNames: [], childNames: [], siblingNames: [] }],
};
const sourceIdentityResolution = resolvePrimaryFamilyAnalysis({
  ...primaryDecision,
  familyId: sourceIdentityFamily.id,
  fingerprint: sourceIdentityFamily.fingerprint,
  familyName: 'Action Slot',
  assetType: 'Slot',
  role: 'ImageButton',
  memberNames: [{ visualHash: sourceIdentityFamily.members[0].visualHash, name: 'Action Slot' }],
  conflict: false,
  reviewNeeded: false,
}, sourceIdentityFamily);
assert.equal(sourceIdentityResolution.familyName, 'Action Slot', 'Kryeo must not replace a model name with source or ancestor wording.');
assert.equal(sourceIdentityResolution.reviewNeeded, false);

const uncertainButCompletePrimary = {
  ...sourceIdentityResolution,
  reviewNeeded: true,
  conflict: false,
  confidence: 0.58,
  alternatives: [{ assetType: 'Badge', reason: 'A compact marker is a plausible secondary reading.' }],
};
assert.equal(
  requiresIndependentFamilyReview(uncertainButCompletePrimary, sourceIdentityFamily),
  false,
  'A complete uncertain primary packet must remain the automatic best decision instead of causing a reviewer burst.',
);
assert.equal(
  requiresIndependentFamilyReview(sourceIdentityResolution, { ...sourceIdentityFamily, assetBoundary: 'composed-parent' }),
  false,
  'A composed parent with a complete coherent primary packet must not be challenged merely because it has construction context.',
);

const incompatibleRolePacket = {
  ...sourceIdentityResolution,
  familyName: 'Action Slot',
  assetType: 'Slot',
  role: 'Frame',
  memberNames: [{ visualHash: sourceIdentityFamily.members[0].visualHash, name: 'Action Slot' }],
  reviewNeeded: false,
  conflict: false,
};
assert.equal(
  requiresIndependentFamilyReview(incompatibleRolePacket, sourceIdentityFamily),
  true,
  'A model packet with an incompatible Roblox role must be sent to independent visual review as one atomic replacement request.',
);
const unresolvedIncompatibleRole = resolveIndependentFamilyAnalysis(incompatibleRolePacket, undefined, sourceIdentityFamily);
assert.equal(unresolvedIncompatibleRole.assetType, 'Slot', 'Kryeo must not locally rewrite a rejected model type.');
assert.equal(unresolvedIncompatibleRole.role, 'Frame', 'Kryeo must not locally rewrite a rejected model role.');
assert.equal(unresolvedIncompatibleRole.reviewNeeded, true, 'No valid reviewer replacement leaves the original packet visibly unresolved.');

assert.equal(requiresIndependentFamilyReview({
  ...primaryDecision,
  familyId: sourceEvidenceFamily.id,
  familyName: 'Background 7',
  assetType: 'Background',
  role: 'ImageLabel',
  memberNames: [{ visualHash: sourceEvidenceFamily.members[0].visualHash, name: 'Background 7' }],
  confidence: 0.91,
  reviewNeeded: false,
  conflict: false,
}, sourceEvidenceFamily), true, 'A generic type-plus-number packet must be sent to visual review before finalization, not silently left unresolved afterwards.');

const composedSlot = {
  ...candidate('composed-slot', 's'.repeat(64), 'ItemSlot7', { x: 0, y: 0, width: 96, height: 96 }, [0.2, 0.5, 0.3]),
  affinityType: 'GroupNode',
  childHierarchyKeys: ['composed-slot.0'],
  grouping: 'existing-group',
};
const slotFamily = buildVisualFamilies([
  composedSlot,
  { ...candidate('composed-slot.0', 't'.repeat(64), 'Layer1', { x: 0, y: 0, width: 96, height: 96 }, [0.1, 0.3, 0.6], 'composed-slot') },
], [], 'Project', 'Document')[0];
assert.equal(slotFamily.sourceTypeHint, 'Slot', 'A direct source token should be exposed as generic model evidence.');
const slotConflict = {
  ...primaryDecision,
  familyId: slotFamily.id,
  familyName: 'Decorative Frame',
  assetType: 'Frame',
  role: 'Frame',
  memberNames: [{ visualHash: slotFamily.members[0].visualHash, name: 'Decorative Frame' }],
  reviewNeeded: true,
  conflict: true,
};
assert.equal(
  familyDecisionConsistencyIssues(slotConflict, slotFamily).length,
  0,
  'Direct source evidence must stay separate from the final consistency validator.',
);
assert.match(
  familyPrimaryEvidenceIssues(slotConflict, slotFamily).join(' | '),
  /source type cue suggests Slot.*selected Frame/i,
  'A direct type disagreement must request an independent visual decision without choosing the replacement locally.',
);
assert.equal(
  requiresIndependentFamilyReview({ ...slotConflict, conflict: false, reviewNeeded: false }, slotFamily),
  true,
  'A complete primary packet that contradicts a direct target type cue must reach the independent visual reviewer.',
);
const reviewedSlotOverride = {
  ...slotConflict,
  familyName: 'Action Frame',
  assetType: 'Frame',
  role: 'Frame',
  memberNames: [{ visualHash: slotFamily.members[0].visualHash, name: 'Action Frame' }],
  reviewNeeded: false,
  conflict: false,
};
const resolvedInteractiveSlot = resolveIndependentFamilyAnalysis(slotConflict, reviewedSlotOverride, slotFamily);
assert.equal(resolvedInteractiveSlot.assetType, 'Frame', 'A source cue must not replace an independently reviewed visual decision.');
assert.equal(resolvedInteractiveSlot.role, 'Frame');
assert.equal(resolvedInteractiveSlot.familyName, 'Action Frame');
assert.equal(resolvedInteractiveSlot.reviewNeeded, false);
assert.equal(resolvedInteractiveSlot.conflict, false);
assert.equal(resolvedInteractiveSlot.alternatives.length, 0);
const unresolvedInteractiveSlot = resolveIndependentFamilyAnalysis(
  { ...slotConflict, conflict: false, reviewNeeded: false },
  undefined,
  slotFamily,
);
assert.equal(unresolvedInteractiveSlot.assetType, 'Frame', 'Kryeo must not replace the primary type locally when review is unavailable.');
assert.equal(unresolvedInteractiveSlot.reviewNeeded, true, 'A missing reviewer may not silently accept a direct type-evidence disagreement.');
assert.equal(unresolvedInteractiveSlot.conflict, true);
const hierarchyOnlySlotFamily = {
  ...slotFamily,
  sourceTypeHint: undefined,
  hierarchyTypeHint: 'Slot',
};

const identityParent = candidate('identity-parent', 'v'.repeat(64), 'WorkbenchSlot', { x: 0, y: 0, width: 96, height: 96 }, [0.4, 0.2, 0.8]);
identityParent.affinityType = 'GroupNode';
identityParent.childHierarchyKeys = ['identity-child'];
const identityChild = candidate('identity-child', 'w'.repeat(64), 'CounterHolder', { x: 0, y: 0, width: 32, height: 20 }, [0.1, 0.8, 0.3], 'identity-parent');
const identityLeakFamily = buildVisualFamilies([identityParent, identityChild], [], 'Project', 'Document')
  .find((family) => family.members[0].hierarchyKey === 'identity-child');
assert.ok(identityLeakFamily, 'A construction child must preserve its own decision scope.');
const copiedAncestorPacket = {
  ...primaryDecision,
  familyId: identityLeakFamily.id,
  fingerprint: identityLeakFamily.fingerprint,
  familyName: 'Workbench Slot',
  assetType: 'Slot',
  role: 'ImageButton',
  memberNames: [{ visualHash: identityLeakFamily.members[0].visualHash, name: 'Workbench Slot' }],
  reviewNeeded: false,
  conflict: false,
};
assert.match(
  familySourceIdentityLeakageIssues(copiedAncestorPacket, identityLeakFamily).join(' | '),
  /reused an ancestor identity.*direct identity/i,
  'A parent-derived child name must be challenged generically when it omits the target\'s direct identity.',
);
assert.equal(
  requiresIndependentFamilyReview(copiedAncestorPacket, identityLeakFamily),
  true,
  'Ancestor identity leakage must request one complete replacement rather than creating a local source-derived name.',
);
const unresolvedCopiedAncestor = resolveIndependentFamilyAnalysis(copiedAncestorPacket, undefined, identityLeakFamily);
assert.equal(unresolvedCopiedAncestor.reviewNeeded, true, 'An unavailable reviewer may not silently accept a copied ancestor identity.');
assert.equal(unresolvedCopiedAncestor.familyName, 'Workbench Slot', 'The guard must never synthesize a replacement name from source text.');
const reviewedConstructionLabel = {
  ...primaryDecision,
  familyId: hierarchyOnlySlotFamily.id,
  familyName: 'Number Label',
  assetType: 'Label',
  role: 'TextLabel',
  memberNames: [{ visualHash: hierarchyOnlySlotFamily.members[0].visualHash, name: 'Number Label' }],
  reviewNeeded: false,
  conflict: false,
};
assert.doesNotMatch(
  familyDecisionConsistencyIssues(reviewedConstructionLabel, hierarchyOnlySlotFamily).join(' | '),
  /hierarchy type cue suggests Slot/i,
  'A reviewed construction child must not remain unresolved merely because its parent hierarchy has a different type.',
);
const guideFamily = buildVisualFamilies([
  candidate('guide-grid', 'u'.repeat(64), 'GuideGrid', { x: 0, y: 0, width: 1920, height: 1080 }, [0.2, 0.2, 0.2]),
], [], 'Project', 'Document')[0];
assert.equal(
  familyDecisionConsistencyIssues({
    ...primaryDecision,
    familyId: guideFamily.id,
    familyName: 'Perspective Guide Wallpaper',
    assetType: 'Wallpaper',
    role: 'ImageLabel',
    memberNames: [{ visualHash: guideFamily.members[0].visualHash, name: 'GuideGrid' }],
    reviewNeeded: false,
    conflict: false,
  }, guideFamily).length,
  0,
  'A guide source label is model context and must not locally challenge a complete decision.',
);

function candidate(id, visualHash, name, bounds, embedding, parentHierarchyKey = 'root') {
  return {
    id,
    name,
    affinityType: 'RasterNode',
    bounds,
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    previewUrl: 'data:image/png;base64,',
    analysisPreviewUrls: [],
    visualHash,
    duplicateFamily: visualHash.slice(0, 12),
    duplicateCount: 1,
    familyName: name,
    suggestedRole: 'Unknown',
    role: 'Unknown',
    assetType: 'Unknown',
    remembered: false,
    members: [{ path: [Number(id)], name, affinityType: 'RasterNode', bounds }],
    grouping: 'single',
    hierarchyKey: id,
    parentHierarchyKey,
    hierarchyDepth: 1,
    childHierarchyKeys: [],
    diveMode: 'keep-together',
    recommendedDiveMode: 'keep-together',
    diveConfidence: 1,
    diveReasons: [],
    visualEmbedding: encodeEmbedding(new Float32Array(embedding)),
    similarityFamily: visualHash.slice(0, 12),
    similarCount: 1,
    duplicateKind: 'unique',
  };
}

const components = applyComponentIntelligence([
  candidate('1', 'a'.repeat(64), 'Layer1', { x: 0, y: 0, width: 91, height: 91 }, [1, 0.06, 0]),
  candidate('2', 'b'.repeat(64), 'Layer2', { x: 100, y: 0, width: 101, height: 101 }, [0.99, 0.08, 0]),
  candidate('3', 'c'.repeat(64), 'Layer3', { x: 0, y: 200, width: 400, height: 24 }, [0, 0, 1]),
]);

assert.equal(components[0].similarityFamily, components[1].similarityFamily);
assert.notEqual(components[0].similarityFamily, components[2].similarityFamily);
assert.equal(components[0].assetType, 'Unknown', 'Local clustering must not assign semantics.');

const families = buildVisualFamilies(components, [], 'Project', 'Document');
assert.equal(families.length, 3);
assert.ok(families.every((family) => family.members.length === 1));
assert.deepEqual(families.map((family) => family.namingScopeKey), ['1', '2', '3']);
const scopeParent = candidate('scope-parent', 'd'.repeat(64), 'Assembly', { x: 0, y: 0, width: 120, height: 120 }, [0, 1, 0]);
scopeParent.childHierarchyKeys = ['scope-child-a', 'scope-child-b'];
const scopeChildA = candidate('scope-child-a', 'e'.repeat(64), 'Named Segment', { x: 0, y: 0, width: 20, height: 20 }, [0, 1, 0], 'scope-parent');
const scopeChildB = candidate('scope-child-b', 'f'.repeat(64), 'Layer', { x: 90, y: 90, width: 20, height: 20 }, [0, 1, 0], 'scope-parent');
const scopedFamilies = buildVisualFamilies([scopeParent, scopeChildA, scopeChildB], [], 'Project', 'Document');
assert.equal(scopedFamilies.length, 3, 'A composed group and its construction layers must each receive a visual decision scope.');
assert.equal(scopedFamilies.find((family) => family.members[0].hierarchyKey === 'scope-parent')?.assetBoundary, 'composed-parent');
assert.equal(scopedFamilies.find((family) => family.members[0].hierarchyKey === 'scope-parent')?.contextMembers?.length, 2, 'Direct child thumbnails must support the composed-parent decision.');
assert.equal(scopeChildA.assetBoundary, 'construction-child');
assert.equal(scopeChildB.assetBoundary, 'construction-child');
assert.equal(scopeChildA.exportTarget, false, 'Construction layers cannot compete with their composed parent in export planning.');
assert.ok(scopedFamilies.some((family) => family.members[0].hierarchyKey === 'scope-child-a'), 'A construction layer must still receive a semantic classification.');
const harmonizedScopeAnalyses = scopedFamilies.map((family) => family.members[0].hierarchyKey === 'scope-parent'
  ? {
      familyId: family.id, fingerprint: family.fingerprint, familyName: 'Decorative Assembly', assetType: 'Frame', role: 'Frame',
      memberNames: [{ visualHash: family.members[0].visualHash, name: 'Decorative Assembly' }], diveMode: 'parent-and-children', reason: 'Parent.', reviewNeeded: false, alternatives: [],
    }
  : {
      familyId: family.id, fingerprint: family.fingerprint,
      familyName: family.members[0].hierarchyKey.endsWith('a') ? 'Top Border Segment' : 'Side Border Segment',
      assetType: 'Border', role: 'ImageLabel', memberNames: [{ visualHash: family.members[0].visualHash, name: 'Layer' }],
      diveMode: 'keep-together', reason: 'Child.', reviewNeeded: false, alternatives: [],
    });
const harmonizedScope = harmonizeFamilyNames(harmonizedScopeAnalyses, scopedFamilies);
const harmonizedChildren = harmonizedScope.filter((analysis) => analysis.assetType === 'Border');
assert.deepEqual(harmonizedChildren.map((analysis) => analysis.familyName), ['Top Border Segment', 'Side Border Segment'], 'Kryeo must preserve model names without imposing sibling descriptors or ordinals.');

const independentlyNamedBars = [
  candidate('bar-health', '1'.repeat(64), 'HealthBar', { x: 0, y: 220, width: 120, height: 12 }, [0, 1, 0]),
  candidate('bar-stamina', '2'.repeat(64), 'StaminaBar', { x: 0, y: 240, width: 120, height: 12 }, [0, 1, 0]),
];
const independentlyNamedBarFamilies = buildVisualFamilies(independentlyNamedBars, [], 'Project', 'Document');
const normalizedDistinctBars = harmonizeFamilyNames(independentlyNamedBarFamilies.map((family, index) => ({
  familyId: family.id, fingerprint: family.fingerprint,
  familyName: index === 0 ? 'Health Bar 2' : 'Stamina Bar 3',
  assetType: 'Bar', role: 'ImageLabel', memberNames: [{ visualHash: family.members[0].visualHash, name: family.members[0].name }],
  diveMode: 'keep-together', reason: 'Distinct standalone bars.', reviewNeeded: false, alternatives: [],
})), independentlyNamedBarFamilies);
assert.deepEqual(
  normalizedDistinctBars.map((analysis) => analysis.familyName),
  ['Health Bar 2', 'Stamina Bar 3'],
  'Kryeo must preserve model ordinals rather than changing names locally.',
);

const verboseParentAnalyses = harmonizedScopeAnalyses.map((analysis) => analysis.familyName === 'Decorative Assembly'
  ? { ...analysis, familyName: 'Complete Decorative Frame', memberNames: analysis.memberNames.map((member) => ({ ...member, name: 'Complete Decorative Frame' })) }
  : analysis);
const conciseContextNames = harmonizeFamilyNames(verboseParentAnalyses, scopedFamilies)
  .filter((analysis) => analysis.assetType === 'Border')
  .map((analysis) => analysis.familyName);
assert.deepEqual(conciseContextNames, ['Top Border Segment', 'Side Border Segment'], 'Kryeo must preserve the independent model names.');

const nestedRoot = candidate('nested-root', 'n'.repeat(64), 'Outer Assembly', { x: 0, y: 0, width: 180, height: 180 }, [0, 1, 0]);
nestedRoot.affinityType = 'GroupNode';
nestedRoot.childHierarchyKeys = ['nested-group', 'nested-leaf'];
const nestedGroup = candidate('nested-group', 'o'.repeat(64), 'Inner Panel', { x: 0, y: 0, width: 140, height: 140 }, [0, 1, 0], 'nested-root');
nestedGroup.affinityType = 'GroupNode';
nestedGroup.childHierarchyKeys = ['nested-child-a', 'nested-child-b'];
const nestedLeaf = candidate('nested-leaf', 'p'.repeat(64), 'Side Border', { x: 140, y: 0, width: 20, height: 140 }, [0, 1, 0], 'nested-root');
const nestedChildA = candidate('nested-child-a', 'q'.repeat(64), 'Layer 1', { x: 0, y: 0, width: 20, height: 20 }, [0, 1, 0], 'nested-group');
const nestedChildB = candidate('nested-child-b', 'r'.repeat(64), 'Layer 2', { x: 20, y: 0, width: 20, height: 20 }, [0, 1, 0], 'nested-group');
const nestedFamilies = buildVisualFamilies([nestedRoot, nestedGroup, nestedLeaf, nestedChildA, nestedChildB], [], 'Project', 'Document');
const nestedAnalyses = nestedFamilies.map((family) => {
  const key = family.members[0].hierarchyKey;
  const isRoot = key === 'nested-root';
  const isGroup = key === 'nested-group';
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: isRoot ? 'Outer Assembly' : isGroup ? 'Inner Panel' : key === 'nested-leaf' ? 'Side Border' : key === 'nested-child-a' ? 'Top Border 4' : 'Bottom Border 7',
    assetType: isRoot || isGroup ? 'Frame' : 'Border',
    role: isRoot || isGroup ? 'Frame' : 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: 'Layer' }],
    diveMode: 'keep-together', reason: 'Nested scope test.', reviewNeeded: false, alternatives: [],
  };
});
const nestedHarmonized = harmonizeFamilyNames(nestedAnalyses, nestedFamilies);
const nestedChildNames = nestedHarmonized
  .filter((analysis) => ['nested-child-a', 'nested-child-b'].includes(nestedFamilies.find((family) => family.id === analysis.familyId)?.members[0]?.hierarchyKey))
  .map((analysis) => analysis.familyName);
assert.deepEqual(nestedChildNames, ['Top Border 4', 'Bottom Border 7'], 'Kryeo must preserve model numbering for nested children.');
const namedConstructionChild = {
  ...scopeChildA,
  familyName: 'Assembly Border 1',
  layerLabel: 'Assembly Border 1',
  exportName: 'Assembly Border 1',
  aiSuggestedName: 'Assembly Border 1',
  aiModelSuggestedName: 'Assembly Border 1',
  assetType: 'Border',
  role: 'ImageLabel',
  analysisSource: 'hosted-family',
  analysisState: 'analyzed',
  exportTarget: false,
  remembered: false,
};
applyComponentSceneContext([namedConstructionChild]);
assert.equal(namedConstructionChild.exportName, 'Assembly Border 1', 'A construction child keeps its completed AI name for Affinity organisation.');
assert.equal(namedConstructionChild.exportTarget, false, 'A construction child remains excluded from the PNG export plan.');
const editableOwner = candidate('editable-owner', '7'.repeat(64), 'Group', { x: 0, y: 320, width: 80, height: 80 }, [0, 1, 0]);
editableOwner.renderHash = 'shared-render';
editableOwner.childHierarchyKeys = ['editable-owner.child'];
const editableOwnerChild = candidate('editable-owner.child', '8'.repeat(64), 'Layer', { x: 0, y: 320, width: 80, height: 20 }, [0, 1, 0], 'editable-owner');
const flatRepresentation = candidate('flat-representation', '9'.repeat(64), 'Raster', { x: 100, y: 320, width: 80, height: 80 }, [0, 1, 0]);
flatRepresentation.renderHash = 'shared-render';
flatRepresentation.keptInsideParent = true;
applyAssetBoundaries([editableOwner, editableOwnerChild, flatRepresentation]);
const duplicateScopedFamilies = buildVisualFamilies([editableOwner, editableOwnerChild, flatRepresentation], [], 'Project', 'Document');
assert.equal(flatRepresentation.assetBoundary, 'duplicate-representation');
assert.equal(flatRepresentation.exportTarget, false);
assert.equal(duplicateScopedFamilies.length, 2, 'The editable group and its construction child receive decisions, while the flattened raster representation remains non-competing evidence.');
assert.ok(!duplicateScopedFamilies.some((family) => family.members[0].hierarchyKey === 'flat-representation'), 'A flattened duplicate must not receive a competing semantic decision.');
const matchingScopeParent = candidate('matching-scope-parent', '1'.repeat(64), 'Assembly Copy', { x: 180, y: 0, width: 120, height: 120 }, [0, 1, 0]);
matchingScopeParent.childHierarchyKeys = ['matching-scope-child-a', 'matching-scope-child-b'];
const matchingScopeChildA = candidate('matching-scope-child-a', '2'.repeat(64), 'Layer', { x: 180, y: 0, width: 20, height: 20 }, [0, 1, 0], 'matching-scope-parent');
const matchingScopeChildB = candidate('matching-scope-child-b', '3'.repeat(64), 'Layer', { x: 270, y: 90, width: 20, height: 20 }, [0, 1, 0], 'matching-scope-parent');
scopeParent.similarityFamily = 'corner-assembly';
scopeParent.similarCount = 2;
matchingScopeParent.similarityFamily = 'corner-assembly';
matchingScopeParent.similarCount = 2;
const visuallyEquivalentScopes = buildVisualFamilies(
  [scopeParent, scopeChildA, scopeChildB, matchingScopeParent, matchingScopeChildA, matchingScopeChildB],
  [],
  'Project',
  'Document',
);
assert.equal(new Set(visuallyEquivalentScopes.map((family) => family.namingScopeKey)).size, 2,
  'Visually similar groups in different hierarchy roots must retain independent decision scopes.');
const constructionContainer = candidate('construction-container', '4'.repeat(64), 'Group', { x: 0, y: 160, width: 120, height: 40 }, [0, 1, 0]);
constructionContainer.diveMode = 'children-only';
constructionContainer.childHierarchyKeys = ['construction-a', 'construction-b'];
const constructionA = candidate('construction-a', '5'.repeat(64), 'Layer', { x: 0, y: 160, width: 20, height: 20 }, [0, 1, 0], 'construction-container');
const constructionB = candidate('construction-b', '6'.repeat(64), 'Layer', { x: 90, y: 180, width: 20, height: 20 }, [0, 1, 0], 'construction-container');
const anonymousSiblingFamilies = buildVisualFamilies(
  [constructionContainer, constructionA, constructionB], [], 'Project', 'Document',
);
assert.equal(anonymousSiblingFamilies.length, 2, 'An organizational parent must expose its independent children as separate decisions.');
assert.deepEqual(
  anonymousSiblingFamilies.map((family) => [family.siblingOrdinal, family.siblingCount]),
  [[1, 2], [2, 2]],
  'Sibling document-order metadata must remain attached to each independent family.',
);
const constructionSiblingFamilies = anonymousSiblingFamilies.map((family) => ({
  ...family,
  assetBoundary: 'construction-child',
}));
const siblingConsistency = familyBatchConsistencyIssues(constructionSiblingFamilies.map((family, index) => ({
  familyId: family.id,
  fingerprint: family.fingerprint,
  familyName: index === 0 ? 'Alpha Border 2' : 'Beta Border 1',
  assetType: 'Border',
  role: 'ImageLabel',
  memberNames: [{ visualHash: family.members[0].visualHash, name: index === 0 ? 'Alpha Border 2' : 'Beta Border 1' }],
  diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
})), constructionSiblingFamilies);
assert.equal(siblingConsistency.size, 0, 'Anonymous sibling numbering drift must be repaired locally rather than triggering a visual review.');
const labelledContainer = candidate('labelled-container', 'l'.repeat(64), 'Assembly', { x: 0, y: 240, width: 120, height: 48 }, [0, 1, 0]);
labelledContainer.diveMode = 'keep-together';
labelledContainer.childHierarchyKeys = ['labelled-primary', 'labelled-secondary'];
const labelledPrimary = candidate('labelled-primary', 'm'.repeat(64), 'PrimaryPanel', { x: 0, y: 240, width: 48, height: 48 }, [0, 1, 0], 'labelled-container');
const labelledSecondary = candidate('labelled-secondary', 'o'.repeat(64), 'StatusBadge', { x: 60, y: 240, width: 24, height: 24 }, [0, 1, 0], 'labelled-container');
const labelledFamilies = buildVisualFamilies(
  [labelledContainer, labelledPrimary, labelledSecondary], [], 'Project', 'Document',
);
const collapsedLabelledAnalyses = labelledFamilies
  .filter((family) => family.assetBoundary === 'construction-child')
  .map((family, index) => ({
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: index === 0 ? 'Assembled Slot 2' : 'Assembled Slot 1',
    assetType: 'Slot',
    role: 'ImageButton',
    memberNames: [{ visualHash: family.members[0].visualHash, name: family.members[0].name }],
    diveMode: 'keep-together', reason: 'Distinct sibling identity test.', reviewNeeded: false, alternatives: [],
  }));
const labelledProvisional = harmonizeFamilyNames(collapsedLabelledAnalyses, labelledFamilies);
assert.deepEqual(
  labelledProvisional.map((analysis) => analysis.familyName),
  ['Assembled Slot 1', 'Assembled Slot 2'],
  'Terminal ordinals are mechanical document-order metadata and must be canonicalized without a visual review.',
);
assert.equal(
  familyBatchConsistencyIssues(labelledProvisional, labelledFamilies).size,
  0,
  'A canonical sibling sequence must remain export-ready rather than becoming a review failure.',
);
const mixedSiblingTypes = familyBatchConsistencyIssues(constructionSiblingFamilies.map((family, index) => ({
  familyId: family.id,
  fingerprint: family.fingerprint,
  familyName: index === 0 ? 'Neutral Border 1' : 'Neutral Frame 2',
  assetType: index === 0 ? 'Border' : 'Frame',
  role: index === 0 ? 'ImageLabel' : 'Frame',
  memberNames: [{ visualHash: family.members[0].visualHash, name: index === 0 ? 'Neutral Border 1' : 'Neutral Frame 2' }],
  diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
})), constructionSiblingFamilies);
assert.equal(mixedSiblingTypes.size, 0, 'Mixed construction types are intentional visual roles, not a sibling-consistency failure.');
const ancestorParent = candidate('ancestor-parent', 'p'.repeat(64), 'Context Assembly', { x: 0, y: 0, width: 120, height: 120 }, [0.2, 0.2, 0.2]);
ancestorParent.diveMode = 'children-only';
ancestorParent.childHierarchyKeys = ['ancestor-child'];
const ancestorChild = candidate('ancestor-child', 'q'.repeat(64), 'Layer', { x: 0, y: 0, width: 96, height: 96 }, [0.2, 0.2, 0.2], 'ancestor-parent');
const ancestorFamily = buildVisualFamilies([ancestorParent, ancestorChild], [], 'Project', 'Document').find((family) => family.members[0].hierarchyKey === 'ancestor-child');
assert.ok(ancestorFamily);
assert.equal(familyDecisionConsistencyIssues({
  familyId: ancestorFamily.id, fingerprint: ancestorFamily.fingerprint, familyName: 'Context Assembly Border', assetType: 'Border', role: 'ImageLabel',
  memberNames: [{ visualHash: ancestorChild.visualHash, name: 'Context Assembly Border' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, ancestorFamily).some((issue) => /ancestor identity/i.test(issue)), false, 'Ancestor wording is naming polish, not a semantic reason to require visual review.');
assert.equal(familyDecisionConsistencyIssues({
  familyId: ancestorFamily.id, fingerprint: ancestorFamily.fingerprint, familyName: 'Context Assembly', assetType: 'Border', role: 'ImageLabel',
  memberNames: [{ visualHash: ancestorChild.visualHash, name: 'Context Assembly' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, ancestorFamily).some((issue) => /missing its final Border type/i.test(issue)), false, 'Name grammar is repaired locally and must not trigger a visual review.');
const identityFamily = buildVisualFamilies([
  candidate('identity-child', 'r'.repeat(64), 'FocusBar', { x: 0, y: 0, width: 180, height: 16 }, [0.4, 0.4, 0.4]),
], [], 'Project', 'Document')[0];
assert.ok(!familyDecisionConsistencyIssues({
  familyId: identityFamily.id, fingerprint: identityFamily.fingerprint, familyName: 'Decorative Blue Bar', assetType: 'Bar', role: 'ImageLabel',
  memberNames: [{ visualHash: identityFamily.members[0].visualHash, name: 'Decorative Blue Bar' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, identityFamily).some((issue) => /human-authored identity/i.test(issue)), 'Source identity can inform confidence but must not force a naming template.');
assert.equal(familyDecisionConsistencyIssues({
  familyId: identityFamily.id, fingerprint: identityFamily.fingerprint, familyName: 'Bar Focus 1', assetType: 'Bar', role: 'ImageLabel',
  memberNames: [{ visualHash: identityFamily.members[0].visualHash, name: 'Bar Focus 1' }], diveMode: 'keep-together', reason: 'Test.', reviewNeeded: false, alternatives: [],
}, identityFamily).some((issue) => /descriptive identity/i.test(issue)), false, 'Type-first model grammar is local naming polish, not a semantic visual conflict.');
assert.equal(planHostedFamilyReview({
  ...families[0],
  reviewSignals: {
    localConfidence: 0.94,
    localMargin: 0.22,
    visualStructureConfidence: 0.88,
    semanticConflict: false,
    meaningfulLayerName: true,
    hierarchyAmbiguity: 0.05,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 1,
  },
}).tier, 'local');
assert.equal(planHostedFamilyReview({
  ...families[1],
  reviewSignals: {
    localConfidence: 0.61,
    localMargin: 0.04,
    visualStructureConfidence: 0.35,
    semanticConflict: true,
    meaningfulLayerName: true,
    hierarchyAmbiguity: 0.7,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 0.5,
  },
}).tier, 'escalation');
assert.equal(planHostedFamilyReview({
  ...families[2],
  reviewSignals: {
    localConfidence: 0.8,
    localMargin: 0.11,
    visualStructureConfidence: 0,
    semanticConflict: false,
    meaningfulLayerName: false,
    hierarchyAmbiguity: 0.15,
    learnedSimilarity: 0,
    learnedFrom: 0,
    localTypeAgreement: 1,
  },
}).tier, 'lite');
const firstFamily = families.find((family) => family.members[0].visualHash === 'a'.repeat(64));
const secondFamily = families.find((family) => family.members[0].visualHash === 'b'.repeat(64));
assert.ok(firstFamily);
assert.ok(secondFamily);

const hosted = applyHostedFamilyAnalyses(components, families, [
  {
    familyId: firstFamily.id,
    fingerprint: firstFamily.fingerprint,
    familyName: 'Sample Border 1',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'a'.repeat(64), name: 'Sample Border 1' }],
    diveMode: 'keep-together',
    reason: 'This visual is a decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
  {
    familyId: secondFamily.id,
    fingerprint: secondFamily.fingerprint,
    familyName: 'Sample Border 2',
    assetType: 'Border',
    role: 'ImageLabel',
    memberNames: [{ visualHash: 'b'.repeat(64), name: 'Sample Border 2' }],
    diveMode: 'keep-together',
    reason: 'This separate visual is another decorative border.',
    reviewNeeded: false,
    alternatives: [],
  },
]);
assert.equal(hosted[0].assetType, 'Border');
assert.equal(hosted[0].familyName, 'Sample Border 1');
assert.equal(hosted[1].familyName, 'Sample Border 2');
assert.equal(hosted[2].analysisState, 'provisional');
assert.equal(hosted[2].assetType, 'Unknown', 'A family without a cloud packet must not retain a local semantic guess.');
assert.equal(hosted[2].exportTarget, false, 'An unresolved family must not be exported automatically.');

const identityComponents = [
  candidate('4', 'd'.repeat(64), 'BadgeAnchor', { x: 0, y: 0, width: 37, height: 23 }, [0.2, 0.3, 0.4]),
  {
    ...candidate('5', 'e'.repeat(64), 'Grid', { x: 0, y: 0, width: 1923, height: 1083 }, [0.4, 0.3, 0.2]),
    semanticType: 'Overlay',
    nameSource: 'layer-name',
  },
  {
    ...candidate('6', 'f'.repeat(64), 'PatternTexture', { x: 0, y: 0, width: 1920, height: 1080 }, [0.3, 0.4, 0.2]),
    semanticType: 'Texture',
    nameSource: 'layer-name',
  },
];
const identityFamilies = buildVisualFamilies(identityComponents, [], 'Project', 'Document');
const identityAnalyses = identityFamilies.map((family) => {
  const sourceName = family.members[0].name;
  const visualType = sourceName === 'BadgeAnchor' ? 'Badge' : sourceName === 'Grid' ? 'Texture' : 'Overlay';
  const modelName = sourceName === 'BadgeAnchor' ? 'Background' : sourceName === 'Grid' ? 'Pattern Grid' : 'Transparent Overlay';
  return {
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: modelName,
    assetType: visualType,
    role: 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: modelName }],
    diveMode: 'keep-together',
    reason: 'Visual analysis.',
    reviewNeeded: false,
    alternatives: [],
  };
});
const identityResults = applyHostedFamilyAnalyses(identityComponents, identityFamilies, identityAnalyses);
assert.equal(identityResults[0].familyName, 'Background', 'Kryeo must display the raw model name instead of deriving a source-based replacement.');
assert.equal(identityResults[0].assetType, 'Badge');
assert.equal(identityResults[1].familyName, 'Pattern Grid', 'Kryeo must not append a type to a model name.');
assert.equal(identityResults[1].assetType, 'Texture');
assert.equal(identityResults[2].familyName, 'Transparent Overlay');





const finalizedIdentityResults = applyComponentSceneContext(identityResults);
assert.equal(finalizedIdentityResults[0].familyName, 'Background', 'Context finalization must preserve the raw model name without creating a replacement.');
assert.equal(finalizedIdentityResults[0].exportName, undefined, 'An unresolved family must not receive a production export name.');
assert.equal(finalizedIdentityResults[0].automationState, 'exception', 'A semantic conflict must remain an automation exception.');
assert.ok((finalizedIdentityResults[0].automationIssues || []).length > 0, 'The unresolved reason must remain visible after context finalization.');
assert.equal(identityResults[2].assetType, 'Overlay');

const weakHostedScene = candidate(
  '7',
  '7'.repeat(64),
  'asset-0001.png',
  { x: 0, y: 0, width: 1929, height: 1089 },
  [0.2, 0.5, 0.3],
);
weakHostedScene.affinityType = 'ImageNode';
weakHostedScene.visualMetrics = {
  visiblePixelRatio: 0.86,
  opaquePixelRatio: 0.8,
  meanAlpha: 0.86,
  edgeVisibleRatio: 0.78,
  centerVisibleRatio: 0.98,
};
weakHostedScene.visualStructureType = 'Wallpaper';
weakHostedScene.visualStructureConfidence = 0.94;
const weakHostedBorder = candidate(
  '8',
  '8'.repeat(64),
  'BorderAssembly',
  { x: 0, y: 0, width: 1985, height: 1145 },
  [0.3, 0.2, 0.5],
);
weakHostedBorder.assetType = 'Background';
weakHostedBorder.semanticType = 'Border';
weakHostedBorder.nameSource = 'layer-name';
weakHostedBorder.visualStructureType = 'Border';
weakHostedBorder.visualStructureConfidence = 0.96;
const weakHostedFamilies = buildVisualFamilies([weakHostedScene, weakHostedBorder], [], 'Project', 'Document');
const weakHostedResults = applyHostedFamilyAnalyses([weakHostedScene, weakHostedBorder], weakHostedFamilies,
  weakHostedFamilies.map((family) => ({
    familyId: family.id,
    fingerprint: family.fingerprint,
    familyName: family.members[0].name === 'asset-0001.png' ? 'Backdrop' : 'Background',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: family.members[0].visualHash, name: family.members[0].name === 'asset-0001.png' ? 'Backdrop' : 'Background' }],
    diveMode: 'keep-together',
    reason: 'Weak hosted result.',
    visualDescription: 'A broad illustrated surface with high visual coverage.',
    confidence: 0.55,
    evidence: { visual: 0, layerName: 0, hierarchy: 0, learned: 0 },
    reviewNeeded: true,
    conflict: false,
    conflictMessage: '',
    alternatives: [],
  })));
assert.equal(weakHostedResults[0].assetType, 'Background');
assert.equal(weakHostedResults[0].familyName, 'Backdrop', 'Kryeo must not append a type to the model name.');
assert.equal(weakHostedResults[1].assetType, 'Background');
assert.equal(weakHostedResults[1].analysisState, 'needs-review');

const decorativeBorderGroup = {
  ...candidate('decorative-group', 'h'.repeat(64), 'BorderLayers', { x: 0, y: 0, width: 121, height: 121 }, [0.2, 0.6, 0.2]),
  affinityType: 'GroupNode',
  grouping: 'existing-group',
  childHierarchyKeys: ['decorative-group.0', 'decorative-group.1', 'decorative-group.2', 'decorative-group.3'],
  visualMetrics: {
    visiblePixelRatio: 0.28,
    opaquePixelRatio: 0.22,
    meanAlpha: 0.25,


    edgeVisibleRatio: 0.01,
    centerVisibleRatio: 0.22,
    innerVisibleRatio: 0.01,
    contentPerimeterVisibleRatio: 0.24,
    contentPerimeterCoverage: 0.86,
  },
};
const decorativeBorderFamilies = buildVisualFamilies([decorativeBorderGroup], [], 'Project', 'Document');
const decorativeBorderResults = applyHostedFamilyAnalyses([decorativeBorderGroup], decorativeBorderFamilies, [{
  familyId: decorativeBorderFamilies[0].id,
  fingerprint: decorativeBorderFamilies[0].fingerprint,
  familyName: 'Border Frame',
  assetType: 'Frame',
  role: 'Frame',
  memberNames: [{ visualHash: decorativeBorderGroup.visualHash, name: 'Border Frame' }],
  diveMode: 'keep-together',
  reason: 'The hosted reviewer called this a frame.',
  visualDescription: '',
  confidence: 0.86,
  evidence: { visual: 0.86, layerName: 0, hierarchy: 0.2, learned: 0 },
  reviewNeeded: false,
  conflict: false,
  conflictMessage: '',
  alternatives: [],
}]);
assert.equal(visualStructureAnchor(decorativeBorderGroup)?.type, 'Border');
assert.equal(decorativeBorderResults[0].assetType, 'Frame');
assert.equal(decorativeBorderResults[0].role, 'Frame');
assert.equal(decorativeBorderResults[0].familyName, 'Border Frame', 'Kryeo must retain the model name even when validation marks the packet unresolved.');
assert.equal(decorativeBorderResults[0].analysisState, 'needs-review');
assert.equal(decorativeBorderResults[0].semanticConflict, true);

const opaqueNameComponents = [
  {
    ...weakHostedScene,
    id: 'opaque-wallpaper',
    hierarchyKey: 'opaque-wallpaper',
    visualHash: 'w'.repeat(64),
    duplicateFamily: 'w'.repeat(12),
    similarityFamily: 'w'.repeat(12),
  },
  {
    ...candidate('opaque-middle', 'm'.repeat(64), 'Marker', { x: 0, y: 0, width: 103, height: 103 }, [0.4, 0.4, 0.2]),
    affinityType: 'GroupNode',
  },
  candidate('opaque-glow', 'g'.repeat(64), 'Layer6Accent', { x: 0, y: 0, width: 103, height: 103 }, [0.2, 0.4, 0.4]),
];
const opaqueNameFamilies = buildVisualFamilies(opaqueNameComponents, [], 'Project', 'Document');
const opaqueNameResults = applyHostedFamilyAnalyses(
  opaqueNameComponents,
  opaqueNameFamilies,
  opaqueNameFamilies.map((family) => {
    const source = family.members[0].name;
    const assetType = source === 'asset-0001.png' ? 'Wallpaper' : source === 'Marker' ? 'Badge' : 'Ornament';
    const visualDescription = source === 'asset-0001.png'
      ? 'A broad illustrated surface with high visual coverage.'
      : source === 'Marker'
        ? 'A decorative diamond medallion with four points.'
        : 'A pale gold diamond glow surrounding a decorative border.';
    return {
      familyId: family.id,
      fingerprint: family.fingerprint,
      familyName: source === 'Layer6Accent' ? 'Perimeter Ornament' : source,
      assetType,
      role: 'ImageLabel',
      memberNames: [{ visualHash: family.members[0].visualHash, name: source === 'Layer6Accent' ? 'Perimeter Ornament' : source }],
      diveMode: 'keep-together',
      reason: 'Visual analysis.',
      visualDescription,
      confidence: 0.9,
      evidence: { visual: 0.9, layerName: 0.1, hierarchy: 0.7, learned: 0 },
      reviewNeeded: false,
      conflict: false,
      conflictMessage: '',
      alternatives: [],
    };
  }),
);
assert.equal(opaqueNameResults[0].familyName, 'Asset 0001', 'Display formatting may remove a filename extension, while the raw packet remains rejected as a file artefact.');
assert.equal(opaqueNameResults[1].familyName, 'Marker', 'Kryeo must not append a type to the model name.');
assert.equal(opaqueNameResults[2].familyName, 'Perimeter Ornament');

const geometryOnlyScene = candidate(
  '9',
  '9'.repeat(64),
  'asset-0001.png',
  { x: 0, y: 0, width: 1929, height: 1089 },
  [0.2, 0.5, 0.3],
);
geometryOnlyScene.affinityType = 'ImageNode';
geometryOnlyScene.visualMetrics = weakHostedScene.visualMetrics;
const geometryOnlyFamilies = buildVisualFamilies([geometryOnlyScene], [], 'Project', 'Document');
const geometryOnlyResults = applyHostedFamilyAnalyses(geometryOnlyFamilies[0].members, geometryOnlyFamilies, [
  {
    familyId: geometryOnlyFamilies[0].id,
    fingerprint: geometryOnlyFamilies[0].fingerprint,
    familyName: 'Backdrop',
    assetType: 'Background',
    role: 'ImageLabel',
    memberNames: [{ visualHash: geometryOnlyScene.visualHash, name: 'Backdrop' }],
    diveMode: 'keep-together',
    reason: 'Weak hosted result.',
    visualDescription: 'A detailed illustrated interior scene.',
    confidence: 0.55,
    evidence: { visual: 0, layerName: 0, hierarchy: 0, learned: 0 },
    reviewNeeded: true,
    conflict: false,
    conflictMessage: '',
    alternatives: [],
  },
]);
assert.equal(visualStructureAnchor(geometryOnlyScene)?.type, 'Wallpaper');
assert.equal(geometryOnlyResults[0].assetType, 'Background');

const approvedFamilies = buildVisualFamilies(components, [{
  visualHash: 'a'.repeat(64),
  familyFingerprint: firstFamily.fingerprint,
  familyMemberHashes: ['a'.repeat(64), 'b'.repeat(64)],
  memberNames: [
    { visualHash: 'a'.repeat(64), name: 'Approved Border 1' },
    { visualHash: 'b'.repeat(64), name: 'Approved Border 2' },
  ],
  project: 'Project',
  scope: 'project',
  approved: true,
  role: 'ImageLabel',
  assetType: 'Border',
  familyName: 'Approved Border',
  diveMode: 'keep-together',
  updatedAt: new Date().toISOString(),
}], 'Project', 'Document');
const reused = applyApprovedFamilies(components, approvedFamilies);
assert.equal(reused[0].familyName, 'Approved Border 1');
assert.equal(reused[0].analysisSource, 'approved-family');
assert.notEqual(reused[1].analysisSource, 'approved-family');

console.log(JSON.stringify({
  families: families.map((family) => family.members.map((member) => member.name)),
  hostedNames: hosted.slice(0, 2).map((component) => component.familyName),
  identityNames: identityResults.map((component) => component.familyName),
  approvedNames: reused.slice(0, 2).map((component) => component.familyName),
}, null, 2));
