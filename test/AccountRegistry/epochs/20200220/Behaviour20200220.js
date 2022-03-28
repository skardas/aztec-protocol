/* globals contract, artifacts, expect */
const {
    JoinSplitProof,
    note,
    signer: { signPermit },
} = require('aztec.js');
const { generateAccount } = require('@aztec/secp256k1');
const truffleAssert = require('truffle-assertions');
const { randomHex, toChecksumAddress } = require('web3-utils');

const ACE = artifacts.require('./ACE');
const AccountRegistryManager = artifacts.require('./AccountRegistry/AccountRegistryManager');
const Behaviour20200106 = artifacts.require('./Behaviour20200106');
const Behaviour20200220 = artifacts.require('./Behaviour20200220');
const DAI = artifacts.require('./test/ERC20/DAI/Dai');
const ZkAsset = artifacts.require('ZkAssetOwnable');

const standardAccount = require('../../../helpers/getOwnerAccount');
const timetravel = require('../../../timeTravel');

contract('Behaviour20200220', async (accounts) => {
    let behaviour20200220;
    let manager;
    let proxyContract;
    let dai;
    let ace;
    let zkAsset;

    const opts = { from: accounts[0] };
    const updatedGSNSignerAddress = '0x5323B6bbD3421983323b3f4f0B11c2D6D3bCE1d8';

    // Signature params
    const chainID = 4;

    beforeEach(async () => {
        ace = await ACE.deployed();
        dai = await DAI.new(chainID, opts);
        zkAsset = await ZkAsset.new(ace.address, dai.address, 1, {
            from: accounts[2],
        });

        const behaviour20200106 = await Behaviour20200106.new();
        const initialBehaviourAddress = behaviour20200106.address;
        const initialGSNSignerAddress = randomHex(20);
        manager = await AccountRegistryManager.new(initialBehaviourAddress, ace.address, initialGSNSignerAddress, opts);

        // perform behaviour upgrade
        behaviour20200220 = await Behaviour20200220.new();
        await manager.upgradeAccountRegistry(behaviour20200220.address);
        const proxyAddress = await manager.proxyAddress();
        proxyContract = await Behaviour20200220.at(proxyAddress);

        // set the GSN signer
        await proxyContract.setGSNSigner();
    });

    describe('Initialisation', async () => {
        it('should have set the GSN signer address', async () => {
            const updatedGSNSigner = await proxyContract.GSNSigner();
            expect(updatedGSNSigner.toString()).to.equal(updatedGSNSignerAddress);
        });

        it('should deploy DAI contract', async () => {
            expect(dai.address).to.not.equal(undefined);
        });
    });

    describe('Success states', async () => {
        it('should update allowance using direct DAI.permit() call', async () => {
            const nonce = 0;
            const expiry = -1; // a massive number in the contract
            const allowed = true;

            const holderAccount = generateAccount();
            const { address: userAddress } = holderAccount;
            const spender = randomHex(20);
            const verifyingContract = dai.address;

            const permitSig = signPermit(chainID, verifyingContract, holderAccount, spender, nonce, expiry, allowed).slice(2);

            const r = `0x${permitSig.slice(0, 64)}`;
            const s = `0x${permitSig.slice(64, 128)}`;
            const v = `0x${permitSig.slice(128, 130)}`;

            const { receipt } = await dai.permit(userAddress, spender, nonce, expiry, allowed, v, r, s);
            expect(receipt.status).to.equal(true);

            const allowance = await dai.allowance.call(userAddress, spender);
            expect(allowance.toString()).to.not.equal('0');
        });

        it('should emit Approval event when permit() is called', async () => {
            const nonce = 0;
            const expiry = -1; // a massive number in the contract
            const allowed = true;

            const holderAccount = generateAccount();
            const { address: userAddress } = holderAccount;
            const spender = randomHex(20);
            const verifyingContract = dai.address;

            const permitSig = signPermit(chainID, verifyingContract, holderAccount, spender, nonce, expiry, allowed).slice(2);

            const r = `0x${permitSig.slice(0, 64)}`;
            const s = `0x${permitSig.slice(64, 128)}`;
            const v = `0x${permitSig.slice(128, 130)}`;

            const { receipt } = await dai.permit(userAddress, spender, nonce, expiry, allowed, v, r, s);
            const event = receipt.logs.find((l) => l.event === 'Approval');

            const emittedUserAddress = event.args.src;
            const emittedSpenderAddress = event.args.guy;

            expect(emittedUserAddress).to.equal(toChecksumAddress(userAddress));
            expect(emittedSpenderAddress).to.equal(toChecksumAddress(spender));
        });

        it('should update allowance using indirect proxyContract.permit() call', async () => {
            const nonce = 0;
            const expiry = -1; // a massive number in the contract
            const allowed = true;

            const linkedTokenAddress = dai.address;
            const holderAccount = generateAccount();
            const { address: userAddress } = holderAccount;

            const spender = proxyContract.address;
            const signature = signPermit(chainID, linkedTokenAddress, holderAccount, spender, nonce, expiry, allowed);

            const { receipt } = await proxyContract.permit(
                linkedTokenAddress,
                userAddress,
                nonce,
                allowed,
                expiry,
                spender,
                signature,
            );
            expect(receipt.status).to.equal(true);

            const allowance = await dai.allowance.call(userAddress, spender);
            expect(allowance.toString()).to.not.equal('0');
        });

        it('should perform deposit, making use of permit() call, without calling approve()', async () => {
            const nonce = 0;
            const expiry = -1; // a massive number in the contract
            const allowed = true;

            const { publicKey, address: userAddress } = standardAccount;

            // mint DAI tokens
            const tokensMinted = 500;
            await dai.mint(userAddress, tokensMinted, opts);

            const inputNotes = [];
            const outputNotes = [await note.create(publicKey, 10), await note.create(publicKey, 5)];
            const publicValue = -15;
            const sender = proxyContract.address;
            const publicOwner = proxyContract.address;

            const depositProof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const spender = proxyContract.address;
            const signature = signPermit(chainID, dai.address, standardAccount, spender, nonce, expiry, allowed);

            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(0);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);

            // Note: No er20.approve() is being made, relying on permit() call in deposit() instead
            const proofData = depositProof.encodeABI(zkAsset.address);
            const proofHash = depositProof.hash;
            const depositAmount = publicValue * -1;

            const { receipt } = await proxyContract.methods[
                'deposit(address,address,bytes32,bytes,uint256,bytes,uint256,uint256)'
            ](zkAsset.address, userAddress, proofHash, proofData, depositAmount, signature, nonce, expiry, { from: userAddress });

            expect(receipt.status).to.equal(true);
            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted - depositAmount);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(depositAmount);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);
        });

        it('should be able to call old Behaviour20200106.deposit() function for alternative approve flow', async () => {
            const { publicKey, address: userAddress } = standardAccount;

            // mint DAI tokens
            const tokensMinted = 500;
            await dai.mint(userAddress, tokensMinted, opts);

            const inputNotes = [];
            const outputNotes = [await note.create(publicKey, 10), await note.create(publicKey, 5)];
            const publicValue = -15;
            const sender = proxyContract.address;
            const publicOwner = proxyContract.address;

            const depositProof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);

            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(0);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);

            // Note: No er20.approve() is being made, relying on permit() call in deposit() instead
            const proofData = depositProof.encodeABI(zkAsset.address);
            const proofHash = depositProof.hash;
            const depositAmount = publicValue * -1;

            // legacy flow - call dai.approve()
            await dai.approve(proxyContract.address, depositAmount, { from: userAddress });

            const { receipt } = await proxyContract.methods['deposit(address,address,bytes32,bytes,uint256)'](
                zkAsset.address,
                userAddress,
                proofHash,
                proofData,
                depositAmount,
                { from: userAddress },
            );

            expect(receipt.status).to.equal(true);
            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted - depositAmount);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(depositAmount);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);
        });
    });

    describe('Failure states', async () => {
        it('should fail to perform deposit if permit signature is fake', async () => {
            const nonce = 0;
            const { publicKey, address: userAddress } = standardAccount;
            const expiry = -1;

            // mint DAI tokens
            const tokensMinted = 500;
            await dai.mint(userAddress, tokensMinted, opts);

            const inputNotes = [];
            const outputNotes = [await note.create(publicKey, 10), await note.create(publicKey, 5)];
            const publicValue = -15;
            const sender = proxyContract.address;
            const publicOwner = proxyContract.address;

            const depositProof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const signature = randomHex(65);

            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(0);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);

            const proofData = depositProof.encodeABI(zkAsset.address);
            const proofHash = depositProof.hash;
            const depositAmount = publicValue * -1;

            await truffleAssert.reverts(
                proxyContract.methods['deposit(address,address,bytes32,bytes,uint256,bytes,uint256,uint256)'](
                    zkAsset.address,
                    userAddress,
                    proofHash,
                    proofData,
                    depositAmount,
                    signature,
                    nonce,
                    expiry,
                    { from: userAddress },
                ),
                'Dai/invalid-permit',
            );
        });

        it('should fail to perform deposit if nonce is incorrect', async () => {
            // incorrect nonce is defined as one which != nonces[user]++
            const nonce = 5;
            const expiry = -1; // a massive number in the contract
            const allowed = true;
            const { publicKey, address: userAddress } = standardAccount;

            // mint DAI tokens
            const tokensMinted = 500;
            await dai.mint(userAddress, tokensMinted, opts);

            const inputNotes = [];
            const outputNotes = [await note.create(publicKey, 10), await note.create(publicKey, 5)];
            const publicValue = -15;
            const sender = proxyContract.address;
            const publicOwner = proxyContract.address;

            const depositProof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const spender = proxyContract.address;
            const signature = signPermit(chainID, dai.address, standardAccount, spender, nonce, expiry, allowed);

            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(0);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);

            const proofData = depositProof.encodeABI(zkAsset.address);
            const proofHash = depositProof.hash;
            const depositAmount = publicValue * -1;

            await truffleAssert.reverts(
                proxyContract.methods['deposit(address,address,bytes32,bytes,uint256,bytes,uint256,uint256)'](
                    zkAsset.address,
                    userAddress,
                    proofHash,
                    proofData,
                    depositAmount,
                    signature,
                    nonce,
                    expiry,
                    { from: userAddress },
                ),
                'Dai/invalid-nonce',
            );
        });

        it('should fail to perform deposit if time is greater than expiry', async () => {
            const nonce = 0;
            const expiry = 100;
            const allowed = true;
            const { publicKey, address: userAddress } = standardAccount;

            // mint DAI tokens
            const tokensMinted = 500;
            await dai.mint(userAddress, tokensMinted, opts);

            const inputNotes = [];
            const outputNotes = [await note.create(publicKey, 10), await note.create(publicKey, 5)];
            const publicValue = -15;
            const sender = proxyContract.address;
            const publicOwner = proxyContract.address;

            const depositProof = new JoinSplitProof(inputNotes, outputNotes, sender, publicValue, publicOwner);
            const spender = proxyContract.address;
            const signature = signPermit(chainID, dai.address, standardAccount, spender, nonce, expiry, allowed);

            expect((await dai.balanceOf(userAddress)).toNumber()).to.equal(tokensMinted);
            expect((await dai.balanceOf(ace.address)).toNumber()).to.equal(0);
            expect((await dai.balanceOf(proxyContract.address)).toNumber()).to.equal(0);

            const proofData = depositProof.encodeABI(zkAsset.address);
            const proofHash = depositProof.hash;
            const depositAmount = publicValue * -1;

            // advance time by > expiry, to check that permit reverts due to expired expiry
            await timetravel.advanceTimeAndBlock(1000);

            await truffleAssert.reverts(
                proxyContract.methods['deposit(address,address,bytes32,bytes,uint256,bytes,uint256,uint256)'](
                    zkAsset.address,
                    userAddress,
                    proofHash,
                    proofData,
                    depositAmount,
                    signature,
                    nonce,
                    expiry,
                    { from: userAddress },
                ),
                'Dai/permit-expired',
            );
        });
    });
});
