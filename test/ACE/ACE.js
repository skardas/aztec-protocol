/* eslint-disable prefer-destructuring */
/* global artifacts, expect, contract, it:true */
const { JoinSplitProof, note, PublicRangeProof } = require('aztec.js');
const bn128 = require('@aztec/bn128');
const { constants, proofs } = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');
const BN = require('bn.js');
const { padLeft } = require('web3-utils');
const truffleAssert = require('truffle-assertions');

const { customMetaData } = require('../helpers/ERC1724');
const { generateFactoryId } = require('../helpers/Factory');

const ACE = artifacts.require('./ACE');
const ACETest = artifacts.require('./ACETest');
const BaseFactory = artifacts.require('./noteRegistry/epochs/201907/base/FactoryBase201907');
const ERC20Mintable = artifacts.require('./ERC20Mintable');
const JoinSplitValidator = artifacts.require('./JoinSplit');
const JoinSplitValidatorInterface = artifacts.require('./JoinSplitInterface');
const PublicRangeValidator = artifacts.require('./PublicRange');
const PublicRangeValidatorInterface = artifacts.require('./PublicRangeInterface');

JoinSplitValidator.abi = JoinSplitValidatorInterface.abi;
PublicRangeValidator.abi = PublicRangeValidatorInterface.abi;

const aztecAccount = secp256k1.generateAccount();
const { BOGUS_PROOF, JOIN_SPLIT_PROOF, PUBLIC_RANGE_PROOF } = proofs;

const getNotes = async (inputNoteValues = [], outputNoteValues = []) => {
    const inputNotes = await Promise.all(
        inputNoteValues.map((inputNoteValue) => note.create(aztecAccount.publicKey, inputNoteValue)),
    );
    const outputNotes = await Promise.all(
        outputNoteValues.map((outputNoteValue) => note.create(aztecAccount.publicKey, outputNoteValue)),
    );
    return { inputNotes, outputNotes };
};

const getDefaultNotes = async () => {
    const inputNoteValues = [10, 10];
    const outputNoteValues = [20, 20];
    const publicValue = -20;
    const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
    return { inputNotes, outputNotes, publicValue };
};

contract('ACE', (accounts) => {
    const sender = accounts[0];
    const publicOwner = accounts[0];

    describe('Initialization', () => {
        let ace;

        beforeEach(async () => {
            ace = await ACE.new({ from: sender });
        });

        it('should set the owner', async () => {
            const owner = await ace.owner();
            expect(owner).to.equal(accounts[0]);
        });

        it('should set the common reference string', async () => {
            await ace.setCommonReferenceString(bn128.CRS, { from: accounts[0] });
            const result = await ace.getCommonReferenceString();
            expect(result).to.deep.equal(bn128.CRS);
        });

        it('should set a proof', async () => {
            const joinSplitValidator = await JoinSplitValidator.new({ from: sender });
            await ace.setProof(JOIN_SPLIT_PROOF, joinSplitValidator.address);
            const resultValidatorAddress = await ace.getValidatorAddress(JOIN_SPLIT_PROOF);
            expect(resultValidatorAddress).to.equal(joinSplitValidator.address);
        });
    });

    describe('Runtime', () => {
        let ace;
        let joinSplitValidator;
        let publicRangeValidator;
        let proof;
        let erc20;

        beforeEach(async () => {
            ace = await ACE.new({ from: sender });
            await ace.setCommonReferenceString(bn128.CRS);
            joinSplitValidator = await JoinSplitValidator.new({ from: sender });
            publicRangeValidator = await PublicRangeValidator.new({ from: sender });
            await ace.setProof(JOIN_SPLIT_PROOF, joinSplitValidator.address);
            await ace.setProof(PUBLIC_RANGE_PROOF, publicRangeValidator.address);

            const baseFactory = await BaseFactory.new(ace.address);
            await ace.setFactory(generateFactoryId(1, 1, 1), baseFactory.address, { from: sender });

            const scalingFactor = new BN(1);
            const canAdjustSupply = false;
            const canConvert = true;

            erc20 = await ERC20Mintable.new();
            await ace.createNoteRegistry(erc20.address, scalingFactor, canAdjustSupply, canConvert, {
                from: sender,
            });
        });

        describe('Success States', () => {
            it('should read the validator address', async () => {
                const validatorAddress = await ace.getValidatorAddress(JOIN_SPLIT_PROOF);
                expect(validatorAddress).to.equal(joinSplitValidator.address);
            });

            it('should increment the latest epoch', async () => {
                const latestEpoch = new BN(await ace.latestEpoch()).add(new BN(1));
                await ace.incrementLatestEpoch();
                const newLatestEpoch = await ace.latestEpoch();
                expect(newLatestEpoch.toString()).to.equal(latestEpoch.toString());
            });

            it('should validate a join-split proof', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
                const data = proof.encodeABI(joinSplitValidator.address);
                const { receipt } = await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
                expect(receipt.status).to.equal(true);
                const result = await ace.validatedProofs(proof.validatedProofHash);
                expect(result).to.equal(true);
            });

            it('should have a wrapper contract validate a join-split transaction', async () => {
                const aceTest = await ACETest.new();
                await aceTest.setACEAddress(ace.address);

                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const data = proof.encodeABI(joinSplitValidator.address);
                const { receipt } = await aceTest.validateProof(JOIN_SPLIT_PROOF, sender, data);
                expect(proof.eth.outputs).to.equal(receipt.logs[0].args.proofOutputs);
            });

            it('should validate-by-hash previously set proofs', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
                const data = proof.encodeABI(joinSplitValidator.address);

                await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
                const result = await ace.validateProofByHash(JOIN_SPLIT_PROOF, proof.hash, sender);
                expect(result).to.equal(true);
            });

            it('should not validate-by-hash not previously set proofs', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const result = await ace.validateProofByHash(proofs.BOGUS_PROOF, proof.hash, sender);
                expect(result).to.equal(false);
            });

            it('should not validate an invalid proof hash', async () => {
                const bogusProofHash = '0x0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';
                const result = await ace.validateProofByHash(JOIN_SPLIT_PROOF, bogusProofHash, sender);
                expect(result).to.equal(false);
            });

            it('should clear previously set proofs', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const data = proof.encodeABI(joinSplitValidator.address);
                await ace.validateProof(JOIN_SPLIT_PROOF, sender, data);
                const firstResult = await ace.validateProofByHash(JOIN_SPLIT_PROOF, proof.hash, sender);
                expect(firstResult).to.equal(true);
                await ace.clearProofByHashes(JOIN_SPLIT_PROOF, [proof.hash]);
                const secondResult = await ace.validateProofByHash(JOIN_SPLIT_PROOF, proof.hash, sender);
                expect(secondResult).to.equal(false);
            });

            it('should validate a join-split proof when metaData has been set', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();

                outputNotes.forEach((individualNote) => {
                    return individualNote.setMetaData(customMetaData.data);
                });

                const proofWithNoteMetaData = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
                const customData = proofWithNoteMetaData.encodeABI(joinSplitValidator.address);
                const { receipt } = await ace.validateProof(JOIN_SPLIT_PROOF, sender, customData);
                expect(receipt.status).to.equal(true);
            });

            it('should validate a utility proof', async () => {
                // Using a public range proof as the utility proof
                const originalNote = await note.create(aztecAccount.publicKey, 20);
                const utilityNote = await note.create(aztecAccount.publicKey, 10);
                const isGreaterOrEqual = true;
                const publicComparison = 10;
                const publicRangeProof = new PublicRangeProof(
                    originalNote,
                    publicComparison,
                    sender,
                    isGreaterOrEqual,
                    utilityNote,
                );
                const publicRangeData = publicRangeProof.encodeABI();

                const { receipt } = await ace.validateProof(PUBLIC_RANGE_PROOF, sender, publicRangeData);
                expect(receipt.status).to.equal(true);
            });

            it('should validatedProofs mapping to false once updateNoteRegistry() called', async () => {
                await erc20.mint(publicOwner, 50);
                await erc20.approve(ace.address, 50);

                const inputNotes = [];
                const outputNotes = [
                    await note.create(aztecAccount.publicKey, 10),
                    await note.create(aztecAccount.publicKey, 40),
                ];
                const publicValue = -50;
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const proofData = proof.encodeABI(joinSplitValidator.address);
                await ace.validateProof(JOIN_SPLIT_PROOF, sender, proofData);
                await ace.publicApprove(sender, proof.hash, 50, { from: sender });

                const validatedProofsKey = proof.validatedProofHash;
                const validatedProofsStatus = await ace.validatedProofs.call(validatedProofsKey);
                expect(validatedProofsStatus).to.equal(true);

                await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, proof.eth.output, sender);
                const postValidatedProofsStatus = await ace.validatedProofs.call(validatedProofsKey);
                expect(postValidatedProofsStatus).to.equal(false);
            });
        });

        describe('Failure States', async () => {
            /* eslint-disable no-unused-vars */
            it('should fail to read a validator address', async () => {
                await truffleAssert.reverts(ace.getValidatorAddress(BOGUS_PROOF), 'expected the validator address to exist');
            });

            it('should not increment the latest epoch if not owner', async () => {
                const opts = { from: accounts[1] };
                await truffleAssert.reverts(ace.incrementLatestEpoch(opts), 'only the owner can update the latest epoch');
            });

            it('should not set a proof if not owner', async () => {
                const opts = { from: accounts[1] };
                await truffleAssert.reverts(
                    ace.setProof(JOIN_SPLIT_PROOF, joinSplitValidator.address, opts),
                    'only the owner can set a proof',
                );
            });

            it("should not set a proof if the proof's epoch is higher than the contract latest epoch", async () => {
                const JOIN_SPLIT_PROOF_V2 = `${parseInt(JOIN_SPLIT_PROOF, 10) + 65536}`; // epoch is 2 instead of 1
                await truffleAssert.reverts(
                    ace.setProof(JOIN_SPLIT_PROOF_V2, joinSplitValidator.address),
                    'the proof epoch cannot be bigger than the latest epoch',
                );
            });

            it('should not set a proof if it had been set already', async () => {
                await truffleAssert.reverts(
                    ace.setProof(JOIN_SPLIT_PROOF, joinSplitValidator.address),
                    'existing proofs cannot be modified',
                );
            });

            it('should not set a proof if validator address does not exist', async () => {
                await truffleAssert.reverts(
                    ace.setProof(JOIN_SPLIT_PROOF, constants.addresses.ZERO_ADDRESS),
                    'expected the validator address to exist',
                );
            });

            it('should not set the common reference string if not owner', async () => {
                const opts = { from: accounts[1] };
                await truffleAssert.reverts(
                    ace.setCommonReferenceString(bn128.CRS, opts),
                    'only the owner can set the common reference string',
                );
            });

            it('should not validate malformed proof data', async () => {
                const data = proof.encodeABI(joinSplitValidator.address);
                const malformedProofData = `0x0123${data.slice(6)}`;
                // no error message because it throws in assembly
                await truffleAssert.reverts(
                    ace.validateProof(JOIN_SPLIT_PROOF, accounts[0], malformedProofData),
                    truffleAssert.ErrorType.REVERT,
                );
            });

            it('should not validate a malformed uint24 proof', async () => {
                const data = proof.encodeABI(joinSplitValidator.address);
                const MALFORMED_PROOF = '0';
                await truffleAssert.reverts(
                    ace.validateProof(MALFORMED_PROOF, accounts[0], data),
                    'expected the proof to be valid',
                );
            });

            it('should not get address of validator if proof was invalidated', async () => {
                await ace.invalidateProof(JOIN_SPLIT_PROOF);

                await truffleAssert.reverts(
                    ace.getValidatorAddress(JOIN_SPLIT_PROOF, { from: accounts[0] }),
                    'expected the validator address to not be disabled',
                );
            });

            it('should not invalidate proof if not owner', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const data = proof.encodeABI(joinSplitValidator.address);
                await ace.validateProof(JOIN_SPLIT_PROOF, accounts[0], data);
                const opts = { from: accounts[1] };
                await truffleAssert.reverts(ace.invalidateProof(JOIN_SPLIT_PROOF, opts), 'only the owner can invalidate a proof');
            });

            it('should not clear empty proof hashes', async () => {
                await truffleAssert.reverts(
                    ace.clearProofByHashes(JOIN_SPLIT_PROOF, [padLeft('0x0', 64)]),
                    'expected no empty proof hash',
                );
            });

            it('should not validate a previously validated join-split proof', async () => {
                const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const data = proof.encodeABI(joinSplitValidator.address);
                await ace.validateProof(JOIN_SPLIT_PROOF, accounts[0], data);
                await ace.invalidateProof(JOIN_SPLIT_PROOF);
                await truffleAssert.reverts(
                    ace.validateProofByHash(JOIN_SPLIT_PROOF, proof.validatedProofHash, accounts[0]),
                    'proof id has been invalidated',
                );
            });

            it('should not clear not previously validated proof hashes', async () => {
                await truffleAssert.reverts(
                    ace.clearProofByHashes(JOIN_SPLIT_PROOF, [proof.validatedProofHash]),
                    'can only clear previously validated proofs',
                );
            });

            it('should not update the validatedProofs mapping for utility proofs', async () => {
                // Using a public range proof as the utility proof
                const originalNote = await note.create(aztecAccount.publicKey, 20);
                const utilityNote = await note.create(aztecAccount.publicKey, 10);
                const isGreaterOrEqual = true;
                const publicComparison = 10;
                const publicRangeProof = new PublicRangeProof(
                    originalNote,
                    publicComparison,
                    sender,
                    isGreaterOrEqual,
                    utilityNote,
                );
                const publicRangeData = publicRangeProof.encodeABI();

                await ace.validateProof(PUBLIC_RANGE_PROOF, sender, publicRangeData);
                await truffleAssert.reverts(
                    ace.updateNoteRegistry(PUBLIC_RANGE_PROOF, publicRangeData, sender),
                    'ACE has not validated a matching proof',
                );
            });

            it('should not allow a proof to be reused as validatedProof mapping should be cleared', async () => {
                // First proof
                await erc20.mint(publicOwner, 50);
                await erc20.approve(ace.address, 50);

                const inputNotes = [];
                const outputNotes = [
                    await note.create(aztecAccount.publicKey, 10),
                    await note.create(aztecAccount.publicKey, 40),
                ];
                const publicValue = -50;
                proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

                const proofData = proof.encodeABI(joinSplitValidator.address);
                await ace.validateProof(JOIN_SPLIT_PROOF, sender, proofData);
                await ace.publicApprove(sender, proof.hash, 50, { from: sender });

                const validatedProofsKey = proof.validatedProofHash;
                await ace.validatedProofs.call(validatedProofsKey);

                await ace.updateNoteRegistry(JOIN_SPLIT_PROOF, proof.eth.output, sender);
                await ace.validatedProofs.call(validatedProofsKey);

                // Attempt to reuse proof, which should now be cleared from validatedProof mapping
                await truffleAssert.reverts(
                    ace.updateNoteRegistry(JOIN_SPLIT_PROOF, proof.eth.output, sender),
                    'ACE has not validated a matching proof',
                );
            });
        });
    });
});
