import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { BigNumber, ethers } from 'ethers';
import { PaginateModel, PaginateOptions } from 'mongoose';
import { FindQueryResult } from '../../commons/decorator';
import { Collection, CollectionDocument } from './collection.schema';

@Injectable()
export class CollectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionService.name);
  private readonly contractProvider = new ethers.providers.JsonRpcProvider(
    process.env.CSC_RPC_URL,
  );
  private readonly nftContractAddress = process.env.NFT_CONTRACT_ADDRESS;

  constructor(
    @InjectModel(Collection.name)
    private readonly collectionModel: PaginateModel<CollectionDocument>,
  ) {}

  async onApplicationBootstrap() {
    if (JSON.parse(process.env.SYNC_ENABLED)) {
      await this.cleanUp();
      await this.syncPreviousCollections();
    }

    await this.handleCollectionCreatedEvent();
  }

  async cleanUp() {
    await this.collectionModel.deleteMany({
      contract: {
        $ne: this.nftContractAddress,
      },
    });
  }

  async handleCollectionCreatedEvent() {
    this.logger.log('Subscribing to CollectionCreated event...');
    const abi = ['event CreateCollection(uint256, string, address)'];
    const contract = new ethers.Contract(
      this.nftContractAddress,
      abi,
      this.contractProvider,
    );
    const onCollectionCreated = async (
      collectionId: BigNumber,
      collectionName: string,
      owner: string,
    ) => {
      this.logger.log(
        `Collection created: ${collectionId}, ${collectionName}, ${owner}`,
      );
      await this.upsertCollection(collectionId, collectionName, owner);
    };
    contract.on('CreateCollection', onCollectionCreated);
  }

  async syncPreviousCollections() {
    this.logger.log('Syncing previous collections...');
    const abi = ['event CreateCollection(uint256, string, address)'];
    const contract = new ethers.Contract(
      this.nftContractAddress,
      abi,
      this.contractProvider,
    );
    const events = await contract.queryFilter(
      'CreateCollection',
      parseInt(process.env.FIRST_BLOCK, 10),
      'latest',
    );
    this.logger.log(`Found ${events.length} events, upserting...`);
    const promises = events.map((event) => {
      this.upsertCollection(event.args[0], event.args[1], event.args[2]);
    });
    this.logger.log(`Synced previous ${promises.length} collections!`);
    return Promise.all(promises);
  }

  async upsertCollection(
    collectionId: BigNumber,
    collectionName: string,
    owner: string,
  ) {
    return this.collectionModel.findOneAndUpdate(
      {
        collectionId: collectionId.toString(),
      },
      {
        collectionId: collectionId.toString(),
        collectionName,
        owner,
        contract: this.nftContractAddress,
      },
      {
        upsert: true,
      },
    );
  }

  async getCollections(findQuery: FindQueryResult) {
    const options: PaginateOptions = {
      ...findQuery.pagination,
      select: '-__v -_id',
    };
    return this.collectionModel.paginate(findQuery.filters, options);
  }
}
