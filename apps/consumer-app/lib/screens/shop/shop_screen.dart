import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../router.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/primitives.dart';
import '../../widgets/toast.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key, required this.shopId, required this.index});
  final String shopId;
  final int index;

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  bool _saved = false;

  @override
  Widget build(BuildContext context) {
    final shop = MockData.shopById(widget.shopId);
    final idx = widget.index.clamp(0, shop.products.length - 1);
    final item = shop.products[idx];
    final others = [
      for (var i = 0; i < shop.products.length; i++)
        if (i != idx) (i, shop.products[i]),
    ].take(4).toList();

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: BeegiiColors.bg,
        body: Stack(
          children: [
            SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: 360,
                    child: BeegiiMedia(
                      gradient: BeegiiGradients.byClass(item.grad),
                      glyph: MediaGlyph.image,
                    ),
                  ),
                  Transform.translate(
                    offset: const Offset(0, -22),
                    child: _content(context, shop, item, others),
                  ),
                ],
              ),
            ),
            _topBar(context),
          ],
        ),
        bottomNavigationBar: _footer(context, item),
      ),
    );
  }

  Widget _topBar(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _frostedButton(Icons.chevron_left_rounded, () => context.pop()),
            _frostedButton(
              Icons.ios_share_rounded,
              () => showBeegiiToast(context, 'Link copied'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _frostedButton(IconData icon, VoidCallback onTap) {
    return Pressable(
      onTap: onTap,
      child: ClipOval(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.9),
              shape: BoxShape.circle,
              border: Border.all(color: BeegiiColors.hair),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0D2A1F12),
                  blurRadius: 2,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            child: Icon(icon, size: 19, color: BeegiiColors.ink2),
          ),
        ),
      ),
    );
  }

  Widget _content(
    BuildContext context,
    ShopCatalog shop,
    ShopProduct item,
    List<(int, ShopProduct)> others,
  ) {
    return Container(
      decoration: const BoxDecoration(
        color: BeegiiColors.bg,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item.title,
            style: BeegiiType.serif(
              size: 24,
              weight: FontWeight.w700,
              height: 1.12,
              letterSpacing: -0.36,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                item.price,
                style: BeegiiType.serif(
                  size: 24,
                  weight: FontWeight.w700,
                  color: BeegiiColors.accentDeep,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                item.digital ? 'instant download' : '+ shipping',
                style: BeegiiType.sans(
                  size: 11.5,
                  weight: FontWeight.w600,
                  color: BeegiiColors.ink3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          _chips(item),
          const SizedBox(height: 16),
          for (var i = 0; i < item.desc.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            Text(
              item.desc[i],
              style: BeegiiType.sans(
                size: 13.5,
                color: BeegiiColors.ink2,
                height: 1.6,
              ),
            ),
          ],
          const SizedBox(height: 20),
          _sellerCard(context, shop),
          const SizedBox(height: 24),
          Text(
            'MORE FROM THIS SHOP',
            style: BeegiiType.sans(
              size: 11,
              weight: FontWeight.w700,
              color: BeegiiColors.ink3,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 11),
          _moreGrid(context, shop, others),
        ],
      ),
    );
  }

  Widget _chips(ShopProduct item) {
    final chips = <Widget>[];
    if (item.digital) {
      chips.add(_chip(Icons.download_rounded, 'Instant download'));
    } else {
      chips.add(_chip(Icons.local_shipping_outlined, 'Ships from Penang'));
      chips.add(_chip(Icons.inventory_2_outlined, 'Made in small batches'));
    }
    chips.add(
      _chip(Icons.verified_user_outlined, 'Verified local seller', good: true),
    );
    return Wrap(spacing: 7, runSpacing: 7, children: chips);
  }

  Widget _chip(IconData icon, String label, {bool good = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
      decoration: BoxDecoration(
        color: good ? const Color(0xFFE5F4EB) : BeegiiColors.surface,
        borderRadius: BorderRadius.circular(999),
        border: good ? null : Border.all(color: const Color(0xFFDDDEDC)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 13,
            color: good ? BeegiiColors.good : BeegiiColors.accentDeep,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: BeegiiType.sans(
              size: 11,
              weight: FontWeight.w600,
              color: good ? const Color(0xFF15633A) : BeegiiColors.ink2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sellerCard(BuildContext context, ShopCatalog shop) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BeegiiColors.hair),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D2A1F12),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: shop.color,
              shape: BoxShape.circle,
            ),
            child: Text(
              shop.init,
              style: BeegiiType.serif(
                size: 17,
                weight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'SOLD BY',
                  style: BeegiiType.sans(
                    size: 9.5,
                    weight: FontWeight.w700,
                    color: BeegiiColors.ink3,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 1),
                Row(
                  children: [
                    Text(
                      shop.name,
                      style: BeegiiType.sans(size: 14, weight: FontWeight.w700),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      width: 16,
                      height: 16,
                      decoration: const BoxDecoration(
                        color: BeegiiColors.accent,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_rounded,
                        size: 10,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Pressable(
            onTap: () => context.go('/explore'),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
              decoration: BoxDecoration(
                color: BeegiiColors.bg,
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: const Color(0xFFDDDEDC)),
              ),
              child: Text(
                'Visit',
                style: BeegiiType.sans(size: 12.5, weight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _moreGrid(
    BuildContext context,
    ShopCatalog shop,
    List<(int, ShopProduct)> others,
  ) {
    final rows = <Widget>[];
    for (var i = 0; i < others.length; i += 2) {
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 13),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _moreCard(context, shop.id, others[i])),
              const SizedBox(width: 13),
              Expanded(
                child: i + 1 < others.length
                    ? _moreCard(context, shop.id, others[i + 1])
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
    }
    return Column(children: rows);
  }

  Widget _moreCard(
    BuildContext context,
    String shopId,
    (int, ShopProduct) entry,
  ) {
    final (i, product) = entry;
    return Pressable(
      onTap: () => context.openShop(shopId, i),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: AspectRatio(
              aspectRatio: 1,
              child: BeegiiMedia(
                gradient: BeegiiGradients.byClass(product.grad),
                glyph: MediaGlyph.image,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            product.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: BeegiiType.sans(
              size: 12.5,
              weight: FontWeight.w600,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            product.price,
            style: BeegiiType.serif(
              size: 13.5,
              weight: FontWeight.w700,
              color: BeegiiColors.accentDeep,
            ),
          ),
        ],
      ),
    );
  }

  Widget _footer(BuildContext context, ShopProduct item) {
    return Container(
      decoration: const BoxDecoration(
        color: BeegiiColors.surface,
        border: Border(top: BorderSide(color: BeegiiColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 13, 18, 13),
          child: Row(
            children: [
              Pressable(
                onTap: () {
                  setState(() => _saved = !_saved);
                  showBeegiiToast(context, _saved ? 'Saved' : 'Removed');
                },
                child: Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: BeegiiColors.bg,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFDDDEDC)),
                  ),
                  child: Icon(
                    _saved ? Icons.favorite : Icons.favorite_border,
                    size: 20,
                    color: _saved ? BeegiiColors.accentDeep : BeegiiColors.ink2,
                  ),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Pressable(
                  onTap: () => showBeegiiToast(context, 'Added to cart'),
                  child: Container(
                    height: 50,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: BeegiiColors.ink,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          item.digital
                              ? Icons.download_rounded
                              : Icons.shopping_bag_outlined,
                          size: 17,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          item.digital ? 'Buy & download' : 'Add to cart',
                          style: BeegiiType.sans(
                            size: 15,
                            weight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
