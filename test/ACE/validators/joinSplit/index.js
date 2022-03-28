/* global artifacts, expect, contract, it:true */
const { JoinSplitProof, keccak, note } = require('aztec.js');
const bn128 = require('@aztec/bn128');
const secp256k1 = require('@aztec/secp256k1');
const BN = require('bn.js');
const truffleAssert = require('truffle-assertions');
const { padLeft, randomHex } = require('web3-utils');

const { FAKE_CRS, mockZeroJoinSplitProof } = require('../../../helpers/proof');

const JoinSplitValidator = artifacts.require('./JoinSplit');
const JoinSplitValidatorInterface = artifacts.require('./JoinSplitInterface');
JoinSplitValidator.abi = JoinSplitValidatorInterface.abi;

const Keccak = keccak;
const aztecAccount = secp256k1.generateAccount();
let joinSplitValidator;

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

/**
 * Note that these tests only validate note-related cryptography. We should consider
 * exploring more edge cases on the agency side, i.`e`. when the public key, the sender or
 * the public owner have bogus values.
 */
contract('Join-Split Validator', (accounts) => {
    const publicOwner = accounts[0];
    const sender = accounts[0];

    before(async () => {
        joinSplitValidator = await JoinSplitValidator.new({ from: sender });
    });

    describe('Success States', () => {
        it('should validate Join-Split proof with negative public value', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with positive public value', async () => {
            const inputNoteValues = [20, 20];
            const outputNoteValues = [10, 10];
            const publicValue = 20;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with many input and output notes', async () => {
            const inputNoteValues = [10, 20, 30, 40, 50, 60, 70, 80, 90];
            const outputNoteValues = [90, 80, 70, 60, 50, 40, 30, 20, 10];
            const publicValue = 0;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with no input notes', async () => {
            const inputNoteValues = [];
            const outputNoteValues = [90, 80, 70, 60, 50, 40, 30, 20, 10];
            const publicValue = -450;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with no output notes', async () => {
            const inputNoteValues = [10, 20, 30, 40, 50, 60, 70, 80, 90];
            const outputNoteValues = [];
            const publicValue = 450;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with input notes of 0 value', async () => {
            const inputNoteValues = [0, 0];
            const outputNoteValues = [20, 30];
            const publicValue = -50;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with output notes of 0 value', async () => {
            const inputNoteValues = [20, 30];
            const outputNoteValues = [0, 0];
            const publicValue = 50;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with the minimum number of notes possible (1 input, 1 output)', async () => {
            const inputNoteValues = [10];
            const outputNoteValues = [10];
            const publicValue = 0;
            const { inputNotes, outputNotes } = await getNotes(inputNoteValues, outputNoteValues);
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should validate Join-Split proof with challenge that has group modulus added to it', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            proof.challenge = proof.challenge.add(bn128.groupModulus);
            proof.constructOutputs();
            const data = proof.encodeABI(joinSplitValidator.address);
            const result = await joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS);
            expect(result).to.equal(proof.eth.outputs);
        });

        it('should succeed for wrong input note owners', async () => {
            // TODO
        });
    });

    describe('Failure States', () => {
        it('should fail if malformed proof data', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            proof.data = [];
            for (let i = 0; i < 4; i += 1) {
                proof.data[i] = [];
                for (let j = 0; j < 6; j += 1) {
                    proof.data[i][j] = randomHex(32);
                }
            }
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if points NOT on curve', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const zeroJoinSplitProof = await mockZeroJoinSplitProof();
            proof.data = zeroJoinSplitProof.data;
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if scalars NOT modulo group modulus', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const kBar = new BN(proof.data[0][0].slice(2), 16);
            proof.data[0][0] = `0x${kBar.add(bn128.groupModulus).toString(16)}`;
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if scalars are 0', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const zeroScalar = padLeft('0x00', 64);
            proof.data[0][0] = zeroScalar;
            proof.data[0][1] = zeroScalar;
            proof.data[1][0] = zeroScalar;
            proof.data[1][1] = zeroScalar;
            proof.data[2][0] = zeroScalar;
            proof.data[2][1] = zeroScalar;
            proof.data[3][0] = zeroScalar;
            proof.data[3][1] = zeroScalar;
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if blinding factors resolve to point at infinity', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            proof.data[0][0] = padLeft('0x05', 64);
            proof.data[0][1] = padLeft('0x05', 64);
            proof.data[0][2] = `0x${bn128.H_X.toString(16)}`;
            proof.data[0][3] = `0x${bn128.H_Y.toString(16)}`;
            proof.data[0][4] = `0x${bn128.H_X.toString(16)}`;
            proof.data[0][5] = `0x${bn128.H_Y.toString(16)}`;
            proof.challenge = new BN('0a', 16);
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if malformed challenge', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            proof.challenge = new BN('0');
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if sender NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // First element should have been the sender
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([proof.publicValue, proof.m, proof.publicOwner, proof.notes, proof.blindingFactors]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if public value NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // Second element should have been the public value
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([proof.sender, proof.m, proof.publicOwner, proof.notes, proof.blindingFactors]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if m NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // Third element should have been m
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([
                proof.sender,
                proof.publicValue,
                proof.publicOwner,
                proof.notes,
                proof.blindingFactors,
            ]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if public owner NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // Fourth element should have been the public owner
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([proof.sender, proof.publicValue, proof.m, proof.notes, proof.blindingFactors]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if notes NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // Fifth element should have been the notes
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([proof.sender, proof.publicValue, proof.m, proof.publicOwner, proof.blindingFactors]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if blinding factors NOT integrated into challenge variable', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            // Sixth element should have been the blinding factors
            proof.challengeHash = new Keccak();
            proof.constructChallengeRecurse([proof.sender, proof.publicValue, proof.m, proof.publicOwner, proof.notes]);
            proof.challenge = proof.challengeHash.redKeccak();
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, bn128.CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail if malformed H_X, H_Y in CRS', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            const malformedHx = bn128.H_X.add(new BN(1));
            const malformedHy = bn128.H_Y.add(new BN(1));
            const malformedCRS = [`0x${malformedHx.toString(16)}`, `0x${malformedHy.toString(16)}`, ...bn128.t2];
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, malformedCRS),
                truffleAssert.ErrorType.REVERT,
            );
        });

        it('should fail for using a fake trusted setup public key', async () => {
            const { inputNotes, outputNotes, publicValue } = await getDefaultNotes();
            const proof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const data = proof.encodeABI(joinSplitValidator.address);
            await truffleAssert.reverts(
                joinSplitValidator.validateJoinSplit(data, sender, FAKE_CRS),
                truffleAssert.ErrorType.REVERT,
            );
        });
    });
});
