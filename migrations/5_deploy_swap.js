/* global artifacts */
const { proofs } = require('@aztec/dev-utils');

const ACE = artifacts.require('./ACE.sol');
const Swap = artifacts.require('./Swap.sol');
const SwapInterface = artifacts.require('./SwapInterface.sol');

Swap.abi = SwapInterface.abi;

module.exports = (deployer) => {
    return deployer.deploy(Swap).then(async ({ address: swapAddress }) => {
        const ace = await ACE.at(ACE.address);
        await ace.setProof(proofs.SWAP_PROOF, swapAddress);
    });
};
