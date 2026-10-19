def discount(total, percent):
    if percent < 0 or percent > 100:
        raise ValueError("Invalid percentage")
    return total * (100 - percent) / 100
