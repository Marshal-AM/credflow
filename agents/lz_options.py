"""LayerZero executor options encoding (type-3, official v2 format)."""


def build_lz_options(gas_limit: int = 200_000) -> bytes:
    """
    Encode LayerZero TYPE_3 executor lzReceive options.
    Matches @layerzerolabs/lz-v2-utilities Options.newOptions().addExecutorLzReceiveOption().
    """
    type3 = (3).to_bytes(2, "big")
    worker_id = bytes([1])  # WorkerId.EXECUTOR
    option_type = bytes([1])  # ExecutorOptionType.LZ_RECEIVE
    gas_params = gas_limit.to_bytes(16, "big")  # uint128
    size = len(gas_params) + len(option_type)
    worker_block = worker_id + size.to_bytes(2, "big") + option_type + gas_params
    return type3 + worker_block
