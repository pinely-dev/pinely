from setuptools import find_packages, setup

package_name = "pinely_ros2"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools", "requests", "eth-account", "web3"],
    zip_safe=True,
    maintainer="PINELY Robotics Engineering",
    description="PINELY ROS2 Autonomous Machine Finance Package on Robinhood Chain",
    license="MIT",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "pinely_node = pinely_ros2.pinely_node:main",
        ],
    },
)
