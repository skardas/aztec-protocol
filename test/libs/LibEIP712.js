/* eslint-disable no-underscore-dangle */
/* global artifacts, contract, expect: true */
const { signer } = require('aztec.js');
const { constants } = require('@aztec/dev-utils');
const secp256k1 = require('@aztec/secp256k1');
const typedData = require('@aztec/typed-data');
const crypto = require('crypto');
const truffleAssert = require('truffle-assertions');
const { keccak256, padLeft } = require('web3-utils');

const LibEIP712 = artifacts.require('./LibEIP712Test');

const computeDomainHash = (validatorAddress) => {
    const types = {
        EIP712Domain: constants.eip712.EIP712_DOMAIN,
    };
    const domain = signer.generateACEDomainParams(validatorAddress, constants.eip712.ACE_DOMAIN_PARAMS);
    return keccak256(`0x${typedData.encodeMessageData(types, 'EIP712Domain', domain)}`);
};

const computeMsgHash = (domainHash, sender) => {
    const noteHash = crypto.randomBytes(32).toString('hex');
    const encodedSender = padLeft(sender.slice(2), 64);
    const status = padLeft(1, 64);
    const hashStruct = keccak256([constants.JOIN_SPLIT_SIGNATURE_TYPE_HASH, noteHash, encodedSender, status].join(''));
    const msg = ['0x1901', domainHash.slice(2), hashStruct.slice(2)].join('');
    const msgHash = keccak256(msg);
    return {
        hashStruct,
        msgHash,
    };
};

contract('LibEIP712', (accounts) => {
    let libEIP712;

    beforeEach(async () => {
        libEIP712 = await LibEIP712.new();
    });

    describe('Success States', async () => {
        it('should correctly compute the domain hash', async () => {
            const domainHash = computeDomainHash(libEIP712.address);
            const result = await libEIP712.EIP712_DOMAIN_HASH();
            expect(result).to.equal(domainHash);
        });

        it('should correctly compute the message hash', async () => {
            const domainHash = computeDomainHash(libEIP712.address);
            const { hashStruct, msgHash } = computeMsgHash(domainHash, accounts[0]);
            const result = await libEIP712._hashEIP712Message(hashStruct);
            expect(result).to.equal(msgHash);
        });

        it('should recover the sender address', async () => {
            const aztecAccount = secp256k1.generateAccount();
            const { signature, encodedTypedData } = signer.signNoteACEDomain(
                libEIP712.address,
                aztecAccount.address,
                aztecAccount.privateKey,
            );
            const result = await libEIP712._recoverSignature(encodedTypedData, signature);
            expect(result).to.equal(aztecAccount.address);
        });
    });

    describe('Failure States', async () => {
        it('should fail when signer is 0x0', async () => {
            const aztecAccount = secp256k1.generateAccount();
            const { signature, encodedTypedData } = signer.signNoteACEDomain(
                libEIP712.address,
                aztecAccount.address,
                aztecAccount.privateKey,
            );

            // see https://ethereum.stackexchange.com/questions/69328/how-to-get-0x0-from-ecrecover/69329#69329

            // Replacing v with an incorrect value of 10
            const incorrectSignature = signature.slice(0, 128) + '10';
            await truffleAssert.reverts(
                libEIP712._recoverSignature(encodedTypedData, incorrectSignature),
                'signer address cannot be 0',
            );
        });

        it('should fail when signature is invalid', async () => {
            const aztecAccount = secp256k1.generateAccount();
            const { signature, encodedTypedData } = signer.signNoteACEDomain(
                libEIP712.address,
                aztecAccount.address,
                aztecAccount.privateKey,
            );

            const seg1 = signature[1].slice(2);
            const v1 = padLeft('0', seg1.length);
            expect(v1).not.to.equal(seg1);
            const invalidSignature1 = `0x${signature[0] + v1 + signature[2].slice(2)}`;
            await truffleAssert.reverts(
                libEIP712._recoverSignature(encodedTypedData, invalidSignature1),
                'signer address cannot be 0',
            );

            const seg2 = signature[2].slice(2);
            const v2 = padLeft('0', seg2.length);
            expect(v2).not.to.equal(seg2);
            const invalidSignature2 = `0x${signature[0] + signature[1].slice(2) + v2}`;
            await truffleAssert.reverts(
                libEIP712._recoverSignature(encodedTypedData, invalidSignature2),
                'signer address cannot be 0',
            );
        });

        it('should fail when signature has wrong length', async () => {
            const aztecAccount = secp256k1.generateAccount();
            const { signature, encodedTypedData } = signer.signNoteACEDomain(
                libEIP712.address,
                aztecAccount.address,
                aztecAccount.privateKey,
            );

            const invalidSignature2 = `0x${signature[0] + signature[1].slice(2) + signature[2].slice(2) + '10'}`;
            await truffleAssert.reverts(
                libEIP712._recoverSignature(encodedTypedData, invalidSignature2),
                'signer address cannot be 0',
            );
        });
    });
});
